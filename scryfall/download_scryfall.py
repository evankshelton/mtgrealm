#!/usr/bin/env python3
"""
download_scryfall.py
--------------------
Downloads MTG card data and reference data from Scryfall's API into a
date-stamped folder. Pure download — no processing.

Downloads:
  - All Cards bulk file (every printing in every language; ~2 GB decompressed)
  - /sets         — full set list with metadata
  - /symbology    — all mana / cost symbols
  - /catalog/*    — official catalogs (creature types, keyword abilities, ...)
  - Card images   — large JPEGs from img.scryfall.io, one per print
                    (sharded by Scryfall UUID into ./scryfall_images/)

Output layout:
  scryfall_data/<YYYY-MM-DD>/
      all_cards.json
      all_cards.meta.json
      sets.json
      symbology.json
      catalogs/
          card-names.json
          creature-types.json
          ...
  scryfall_images/
      {c1}/{c2}/{scryfall_id}.large.jpg
      {c1}/{c2}/{scryfall_id}.front.large.jpg   (DFC fronts)
      {c1}/{c2}/{scryfall_id}.back.large.jpg    (DFC backs)
      ...

Skip behavior:
  - If today's folder already has a file, it is left alone (unless --force).
  - For the bulk file specifically, the script also scans prior day folders for
    a meta whose `updated_at` matches Scryfall's current manifest. If a match
    is found, the existing file is hard-linked into today's folder instead of
    re-downloading (~2 GB saved). --force disables this.

Usage:
  python download_scryfall.py
  python download_scryfall.py --output-dir ./scryfall_data
  python download_scryfall.py --force
  python download_scryfall.py --keep-compressed

Requirements:
  pip install -r requirements.txt
"""

import argparse
import gzip
import json
import os
import shutil
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("[X] The 'requests' library is required.", file=sys.stderr)
    print("    Run:  pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)

try:
    import ijson
except ImportError:
    print("[X] The 'ijson' library is required (for streaming the bulk file).",
          file=sys.stderr)
    print("    Run:  pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCRYFALL_API_BASE = "https://api.scryfall.com"
BULK_TYPE = "all_cards"

# Scryfall asks for a clearly identifying User-Agent and an Accept header.
# See https://scryfall.com/docs/api
HEADERS = {
    "User-Agent": "mtg-scryfall-downloader/0.1 (+https://github.com/local/mtg)",
    "Accept": "application/json",
}

# Cool-down between API calls. Scryfall's published guideline is 50–100 ms.
REQUEST_DELAY_S = 0.1

# Catalog endpoints under /catalog/*. Source: https://scryfall.com/docs/api/catalogs
CATALOGS = [
    "card-names",
    "artist-names",
    "word-bank",
    "supertypes",
    "card-types",
    "artifact-types",
    "battle-types",
    "creature-types",
    "enchantment-types",
    "land-types",
    "planeswalker-types",
    "spell-types",
    "powers",
    "toughnesses",
    "loyalties",
    "keyword-abilities",
    "keyword-actions",
    "ability-words",
    "watermarks",
]

# Image downloads. Sizes correspond to keys in Scryfall card.image_uris.
DEFAULT_IMAGES_DIR = Path("./scryfall_images")
DEFAULT_IMAGE_SIZES = ("large",)
DEFAULT_IMAGE_WORKERS = 8
DEFAULT_IMAGE_RATE = 10.0  # requests / second

# Card-back design images live on a separate host. URL pattern:
#   {base}/{size}/{c1}/{c2}/{card_back_id}.jpg
SCRYFALL_BACKS_BASE = "https://backs.scryfall.io"


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def fetch_json(url: str, session: requests.Session) -> dict:
    r = session.get(url, timeout=30)
    r.raise_for_status()
    return r.json()


def fetch_following_pagination(url: str, session: requests.Session) -> dict:
    """GET a Scryfall List endpoint and follow `next_page` until exhausted.

    Returns a single combined response shaped like the first page, with `data`
    concatenated, `has_more` set to false, and `next_page` removed.
    """
    first = fetch_json(url, session)
    if not first.get("has_more"):
        return first

    all_data = list(first.get("data") or [])
    next_url = first.get("next_page")
    while next_url:
        time.sleep(REQUEST_DELAY_S)
        page = fetch_json(next_url, session)
        all_data.extend(page.get("data") or [])
        next_url = page.get("next_page") if page.get("has_more") else None

    combined = dict(first)
    combined["data"] = all_data
    combined["has_more"] = False
    combined.pop("next_page", None)
    if "total_cards" in combined:
        combined["total_cards"] = len(all_data)
    return combined


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def write_json_atomic(payload, dest: Path) -> None:
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    tmp.replace(dest)


def draw_progress(downloaded: int, total: int, bar_len: int = 40) -> None:
    if total:
        pct = min(downloaded / total * 100, 100)
        filled = int(bar_len * pct / 100)
        bar = "#" * filled + "-" * (bar_len - filled)
        print(
            f"\r  [{bar}] {pct:5.1f}%  "
            f"{downloaded/1_048_576:7.1f}/{total/1_048_576:.1f} MB",
            end="", flush=True,
        )
    else:
        print(f"\r  Downloaded {downloaded/1_048_576:.1f} MB ...",
              end="", flush=True)


# ---------------------------------------------------------------------------
# Bulk-data download
# ---------------------------------------------------------------------------

def find_prior_bulk(root: Path, bulk_type: str, updated_at: str,
                    exclude: Path) -> Path | None:
    """Look for an existing bulk JSON in any prior day folder whose meta
    matches the given updated_at. Skips `exclude` (typically today's folder).
    Returns the path to the existing JSON file, or None.
    """
    if not root.exists():
        return None
    for day_dir in sorted(root.iterdir(), reverse=True):
        if not day_dir.is_dir() or day_dir.resolve() == exclude.resolve():
            continue
        meta_path = day_dir / f"{bulk_type}.meta.json"
        json_path = day_dir / f"{bulk_type}.json"
        if not (meta_path.exists() and json_path.exists()):
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if meta.get("updated_at") == updated_at:
            return json_path
    return None


def link_or_copy(src: Path, dst: Path) -> str:
    """Hard-link src to dst; fall back to copy if linking fails (e.g. across
    filesystems). Returns 'link' or 'copy'.
    """
    try:
        os.link(src, dst)
        return "link"
    except OSError:
        shutil.copy2(src, dst)
        return "copy"


def download_bulk(manifest_entry: dict, folder: Path, session: requests.Session,
                  *, force: bool, keep_compressed: bool) -> None:
    bulk_type = manifest_entry["type"]
    download_uri = manifest_entry["download_uri"]
    updated_at = manifest_entry["updated_at"]
    bulk_name = manifest_entry.get("name", bulk_type)

    json_path = folder / f"{bulk_type}.json"
    gz_path = folder / f"{bulk_type}.json.gz"
    meta_path = folder / f"{bulk_type}.meta.json"

    print()
    print("=" * 60)
    print(f"  Bulk: {bulk_name}  (type={bulk_type})")
    print(f"  Updated at : {updated_at}")
    print(f"  Source URL : {download_uri}")
    print("=" * 60)

    # Same-day skip.
    if not force and meta_path.exists() and json_path.exists():
        try:
            local_meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            local_meta = {}
        if local_meta.get("updated_at") == updated_at:
            print(f"[skip] {json_path.name} already current ({updated_at}).")
            return

    # Cross-day reuse: if a prior folder has a matching meta, link the file
    # forward into today's folder instead of re-downloading.
    if not force:
        prior = find_prior_bulk(folder.parent, bulk_type, updated_at,
                                exclude=folder)
        if prior:
            mode = link_or_copy(prior, json_path)
            write_json_atomic(manifest_entry, meta_path)
            print(f"[reuse] Manifest unchanged since {prior.parent.name}.")
            print(f"        {mode}: {prior}  ->  {json_path}")
            return

    # Actual download.
    gz_tmp = gz_path.with_suffix(gz_path.suffix + ".tmp")
    print(f"[*] Downloading bulk file ...")
    with session.get(download_uri, stream=True, timeout=120) as r:
        r.raise_for_status()
        # Keep transport-level gzip bytes so Content-Length matches our progress
        # counter. We decompress in a second step below.
        r.raw.decode_content = False
        total = int(r.headers.get("Content-Length", 0))
        downloaded = 0
        with open(gz_tmp, "wb") as f:
            for chunk in iter(lambda: r.raw.read(1 << 16), b""):
                f.write(chunk)
                downloaded += len(chunk)
                draw_progress(downloaded, total)
    print()
    gz_tmp.replace(gz_path)

    # Decompress to .json
    print(f"[*] Decompressing to {json_path.name} ...")
    json_tmp = json_path.with_suffix(json_path.suffix + ".tmp")
    with gzip.open(gz_path, "rb") as src, open(json_tmp, "wb") as dst:
        shutil.copyfileobj(src, dst, length=1 << 20)
    json_tmp.replace(json_path)

    # Persist the manifest entry so future runs can detect "up to date".
    write_json_atomic(manifest_entry, meta_path)

    if not keep_compressed:
        gz_path.unlink(missing_ok=True)
        print(f"[*] Removed compressed file.")
    else:
        print(f"[*] Kept compressed file: {gz_path.name}")

    size_mb = json_path.stat().st_size / 1_048_576
    print(f"[OK] {json_path.name}  ({size_mb:.0f} MB)")


# ---------------------------------------------------------------------------
# Auxiliary endpoint downloads
# ---------------------------------------------------------------------------

def download_list_endpoint(url: str, dest: Path, session: requests.Session,
                           *, force: bool, label: str) -> None:
    if dest.exists() and not force:
        print(f"[skip] {dest.name} already exists.")
        return
    print(f"[*] {label}: GET {url}")
    time.sleep(REQUEST_DELAY_S)
    payload = fetch_following_pagination(url, session)
    write_json_atomic(payload, dest)
    count = len(payload.get("data") or [])
    print(f"[OK] {dest.name}  ({count} items)")


def download_catalog(name: str, catalogs_dir: Path, session: requests.Session,
                     *, force: bool) -> None:
    dest = catalogs_dir / f"{name}.json"
    if dest.exists() and not force:
        print(f"[skip] catalogs/{dest.name}")
        return
    url = f"{SCRYFALL_API_BASE}/catalog/{name}"
    time.sleep(REQUEST_DELAY_S)
    try:
        payload = fetch_json(url, session)
    except requests.HTTPError as e:
        print(f"[!] catalogs/{name}: {e}")
        return
    write_json_atomic(payload, dest)
    count = len(payload.get("data") or [])
    print(f"[OK] catalogs/{dest.name}  ({count} entries)")


# ---------------------------------------------------------------------------
# Card images
# ---------------------------------------------------------------------------


class RateLimiter:
    """Token-bucket-style limiter shared across worker threads."""

    def __init__(self, rate_per_sec: float):
        self.min_interval = 1.0 / rate_per_sec if rate_per_sec > 0 else 0.0
        self._lock = threading.Lock()
        self._next_time = 0.0

    def wait(self) -> None:
        if self.min_interval <= 0:
            return
        with self._lock:
            now = time.monotonic()
            sleep_for = self._next_time - now
            if sleep_for > 0:
                time.sleep(sleep_for)
                now = time.monotonic()
            self._next_time = now + self.min_interval


def download_one_image(session: requests.Session, limiter: RateLimiter,
                       url: str, dest: Path, retries: int = 3) -> str:
    """Download URL to dest atomically.

    Returns 'ok' | 'skip' | 'miss' (404) | 'err:<msg>'.
    """
    if dest.exists() and dest.stat().st_size > 0:
        return "skip"

    tmp = dest.with_suffix(dest.suffix + ".tmp")
    last_err = None
    for attempt in range(retries):
        limiter.wait()
        try:
            r = session.get(url, timeout=30, stream=True)
        except requests.RequestException as e:
            last_err = type(e).__name__
            time.sleep(1 + attempt)
            continue

        if r.status_code == 200:
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(chunk_size=1 << 16):
                    if chunk:
                        f.write(chunk)
            tmp.replace(dest)
            return "ok"
        if r.status_code == 404:
            return "miss"
        if r.status_code == 429:
            try:
                retry_after = float(r.headers.get("Retry-After", "5"))
            except ValueError:
                retry_after = 5.0
            time.sleep(min(retry_after, 30.0))
            continue
        last_err = f"HTTP {r.status_code}"
        time.sleep(1 + attempt)

    return f"err:{last_err}"


def face_label(index: int) -> str:
    if index == 0:
        return "front"
    if index == 1:
        return "back"
    return f"face{index}"


def iter_image_tasks(all_cards_path: Path, images_dir: Path,
                     sizes: tuple[str, ...],
                     lang_filter: set[str] | None):
    """Stream the bulk file, yielding (url, dest) tuples for every image
    URI we want to download. Uses ijson so we never hold the 2 GB+ file
    in memory.

    Also yields tasks for each unique `card_back_id` referenced by the
    cards (deduplicated — most cards share the default Magic back, so
    that image only enqueues once).
    """
    seen_backs: set[str] = set()
    backs_dir = images_dir / "card_backs"
    with open(all_cards_path, "rb") as f:
        for card in ijson.items(f, "item"):
            scryfall_id = card.get("id")
            if not scryfall_id or len(scryfall_id) < 2:
                continue
            lang = card.get("lang") or ""
            if lang_filter and lang not in lang_filter:
                continue

            c1, c2 = scryfall_id[0], scryfall_id[1]
            subdir = images_dir / c1 / c2

            # Scryfall puts image_uris EITHER on the card OR on each face,
            # not both. Prefer per-face when present.
            faces = card.get("card_faces") or []
            faces_with_imgs = [f for f in faces if f.get("image_uris")]
            if faces_with_imgs:
                for i, face in enumerate(faces_with_imgs):
                    uris = face["image_uris"]
                    label = face_label(i)
                    for size in sizes:
                        url = uris.get(size)
                        if url:
                            dest = subdir / f"{scryfall_id}.{label}.{size}.jpg"
                            yield (url, dest)
            else:
                uris = card.get("image_uris") or {}
                for size in sizes:
                    url = uris.get(size)
                    if url:
                        dest = subdir / f"{scryfall_id}.{size}.jpg"
                        yield (url, dest)

            # Card-back design image. Deduplicated across the run — most
            # cards share the default Magic back so this only enqueues
            # the first time we see each unique card_back_id.
            cb_id = card.get("card_back_id")
            if cb_id and len(cb_id) >= 2 and cb_id not in seen_backs:
                seen_backs.add(cb_id)
                cb1, cb2 = cb_id[0], cb_id[1]
                back_subdir = backs_dir / cb1 / cb2
                for size in sizes:
                    url = f"{SCRYFALL_BACKS_BASE}/{size}/{cb1}/{cb2}/{cb_id}.jpg"
                    dest = back_subdir / f"{cb_id}.{size}.jpg"
                    yield (url, dest)


def download_card_images(all_cards_path: Path, images_dir: Path,
                         *, sizes: tuple[str, ...], workers: int,
                         rate_per_sec: float,
                         lang_filter: set[str] | None) -> None:
    if not all_cards_path.exists():
        print(f"[!] Skipping images — bulk file not found at {all_cards_path}")
        return

    images_dir.mkdir(parents=True, exist_ok=True)

    print()
    print("=" * 60)
    print(f"  Card images")
    print(f"  Source : {all_cards_path}")
    print(f"  Dest   : {images_dir.resolve()}")
    print(f"  Sizes  : {', '.join(sizes)}")
    print(f"  Langs  : {','.join(sorted(lang_filter)) if lang_filter else 'all'}")
    print(f"  Workers: {workers}  rate~{rate_per_sec:g}/s")
    print("=" * 60)

    print("[*] Scanning bulk file for image URIs (this takes a few minutes "
          "on a 2 GB file) ...")
    print("    Files already on disk are skipped during this pass, so a "
          "resumed run picks up where it left off.")
    tasks: list[tuple[str, Path]] = []
    already_have = 0
    scanned = 0
    scan_start = time.monotonic()
    last_log = scan_start
    for url, dest in iter_image_tasks(all_cards_path, images_dir, sizes,
                                      lang_filter):
        scanned += 1
        if dest.exists() and dest.stat().st_size > 0:
            already_have += 1
        else:
            tasks.append((url, dest))
        now = time.monotonic()
        if now - last_log >= 5.0:
            print(f"    scanned {scanned:>9,d}   "
                  f"already on disk: {already_have:>9,d}   "
                  f"to download: {len(tasks):>9,d}")
            last_log = now

    print(f"[*] Scan complete in {time.monotonic() - scan_start:.0f}s: "
          f"{scanned:,} candidates, {already_have:,} on disk, "
          f"{len(tasks):,} to download.")

    if not tasks:
        print("[OK] Nothing to do — all images present.")
        return

    # Pre-create shard subdirs to avoid the worker threads racing on mkdir.
    for subdir in {dest.parent for _, dest in tasks}:
        subdir.mkdir(parents=True, exist_ok=True)

    limiter = RateLimiter(rate_per_sec)
    session = requests.Session()
    session.headers.update({
        "User-Agent": HEADERS["User-Agent"],
        "Accept": "image/jpeg,image/*",
    })

    counts = {"ok": 0, "skip": 0, "miss": 0, "err": 0}
    counts_lock = threading.Lock()
    sample_errors: list[str] = []

    def work(task):
        url, dest = task
        result = download_one_image(session, limiter, url, dest)
        kind = "err" if result.startswith("err:") else result
        with counts_lock:
            counts[kind] += 1
            if kind == "err" and len(sample_errors) < 5:
                sample_errors.append(f"{url}  ->  {result}")
        return result

    progress_step = max(1000, len(tasks) // 50)
    try:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = [ex.submit(work, t) for t in tasks]
            done = 0
            for _ in as_completed(futures):
                done += 1
                if done % progress_step == 0 or done == len(tasks):
                    with counts_lock:
                        c = dict(counts)
                    print(f"    [{done:>7,d}/{len(tasks):,d}]  "
                          f"ok={c['ok']:,}  skip={c['skip']:,}  "
                          f"miss={c['miss']:,}  err={c['err']:,}")
    except KeyboardInterrupt:
        print("\n[!] Interrupted — cancelling pending downloads.")
        raise

    print()
    print("=" * 60)
    print(f"[OK] Images: ok={counts['ok']:,}  skip={counts['skip']:,}  "
          f"miss(404)={counts['miss']:,}  err={counts['err']:,}")
    if sample_errors:
        print("     Sample errors:")
        for line in sample_errors:
            print(f"       {line}")
    print("=" * 60)


# ---------------------------------------------------------------------------
# Main / CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download MTG card data from Scryfall into a "
                    "date-stamped folder.",
    )
    parser.add_argument("--output-dir", default="./scryfall_data",
                        help="Root output directory (default: ./scryfall_data)")
    parser.add_argument("--force", action="store_true",
                        help="Re-download everything, ignoring same-day and "
                             "cross-day skip optimizations.")
    parser.add_argument("--keep-compressed", action="store_true",
                        help="Keep the .json.gz file after decompression.")
    parser.add_argument("--skip-bulk", action="store_true",
                        help="Skip the All Cards bulk file (only fetch sets, "
                             "symbology, catalogs).")
    parser.add_argument("--skip-aux", action="store_true",
                        help="Skip /sets, /symbology, and /catalog/*.")
    parser.add_argument("--skip-images", action="store_true",
                        help="Skip downloading card images.")
    parser.add_argument("--images-dir", default=str(DEFAULT_IMAGES_DIR),
                        help=f"Image output root (default: {DEFAULT_IMAGES_DIR}). "
                             f"Files land at {{c1}}/{{c2}}/{{scryfall_id}}.{{size}}.jpg.")
    parser.add_argument("--image-sizes", default=",".join(DEFAULT_IMAGE_SIZES),
                        help="Comma-separated Scryfall image sizes to download "
                             "(default: large). Other valid values: small, "
                             "normal, png, art_crop, border_crop.")
    parser.add_argument("--image-langs", default="",
                        help="Comma-separated language filter, e.g. 'en' or "
                             "'en,ja'. Empty = all languages (default).")
    parser.add_argument("--image-workers", type=int,
                        default=DEFAULT_IMAGE_WORKERS,
                        help=f"Concurrent image downloads "
                             f"(default: {DEFAULT_IMAGE_WORKERS}).")
    parser.add_argument("--image-rate", type=float,
                        default=DEFAULT_IMAGE_RATE,
                        help=f"Global image rate, req/s "
                             f"(default: {DEFAULT_IMAGE_RATE}).")
    args = parser.parse_args()

    today = datetime.now().strftime("%Y-%m-%d")
    folder = Path(args.output_dir) / today
    folder.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update(HEADERS)

    print("=" * 60)
    print("  Scryfall data downloader")
    print(f"  Output : {folder.resolve()}")
    print("=" * 60)

    # 1. Bulk-data manifest
    if not args.skip_bulk:
        print("[*] Fetching bulk-data manifest ...")
        manifest = fetch_json(f"{SCRYFALL_API_BASE}/bulk-data", session)
        entries = {e["type"]: e for e in manifest.get("data", [])}
        if BULK_TYPE not in entries:
            available = ", ".join(sorted(entries))
            print(f"[X] Bulk type '{BULK_TYPE}' not in manifest. "
                  f"Available: {available}", file=sys.stderr)
            sys.exit(1)
        download_bulk(
            entries[BULK_TYPE], folder, session,
            force=args.force, keep_compressed=args.keep_compressed,
        )

    # 2. Auxiliary endpoints
    if not args.skip_aux:
        print()
        print("=" * 60)
        print("  Auxiliary endpoints")
        print("=" * 60)
        download_list_endpoint(
            f"{SCRYFALL_API_BASE}/sets", folder / "sets.json", session,
            force=args.force, label="sets",
        )
        download_list_endpoint(
            f"{SCRYFALL_API_BASE}/symbology", folder / "symbology.json", session,
            force=args.force, label="symbology",
        )

        catalogs_dir = folder / "catalogs"
        catalogs_dir.mkdir(exist_ok=True)
        print(f"[*] catalogs: {len(CATALOGS)} endpoints")
        for name in CATALOGS:
            download_catalog(name, catalogs_dir, session, force=args.force)

    # 3. Card images
    if not args.skip_images:
        sizes = tuple(s.strip() for s in args.image_sizes.split(",") if s.strip())
        langs_raw = [s.strip() for s in args.image_langs.split(",") if s.strip()]
        lang_filter = set(langs_raw) if langs_raw else None
        bulk_path = folder / f"{BULK_TYPE}.json"
        download_card_images(
            bulk_path,
            Path(args.images_dir),
            sizes=sizes,
            workers=args.image_workers,
            rate_per_sec=args.image_rate,
            lang_filter=lang_filter,
        )

    print()
    print("=" * 60)
    print(f"[OK] Done. Files in {folder.resolve()}")
    print("=" * 60)


if __name__ == "__main__":
    main()

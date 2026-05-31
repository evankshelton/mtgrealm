#!/usr/bin/env python3
"""
download_mtgjson.py
--------------------
Downloads the complete Magic: The Gathering card database from MTGJSON
using their official API v5 (https://mtgjson.com/api/v5/).

File downloaded: AllPrintings.json.gz
  - Contains every card printing across all sets, organized by set code.
  - Described by the Set Data Model and Card (Set) Data Model.
  - Source: https://mtgjson.com/downloads/all-files/#allprintings

The script will:
  1. Check Meta.json to report the current database build date/version.
  2. Skip re-downloading if a valid, up-to-date file already exists.
  3. Download AllPrintings.json.gz with a progress bar.
  4. Verify integrity via the official SHA-256 checksum file.
  5. Decompress the file to AllPrintings.json.

Usage:
  python download_mtgjson.py [--output-dir ./mtgjson_data] [--force] [--keep-compressed]

Requirements:
  pip install requests   (stdlib urllib is blocked by MTGJSON's Cloudflare WAF)

Options:
  --output-dir        Directory to save files (default: ./mtgjson_data)
  --force             Re-download even if a valid file already exists
  --keep-compressed   Keep the .gz file after decompression
"""

import argparse
import gzip
import hashlib
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Dependency check — requests is required; urllib is blocked by Cloudflare
# ---------------------------------------------------------------------------
try:
    import requests
except ImportError:
    print("[✗] The 'requests' library is required but not installed.")
    print("    Run:  pip install requests")
    sys.exit(1)

BASE_URL          = "https://mtgjson.com/api/v5"
COMPRESSED_FILENAME = "AllPrintings.json.gz"
OUTPUT_FILENAME     = "AllPrintings.json"
META_FILENAME       = "Meta.json"

# MTGJSON's server (Cloudflare WAF) blocks Python's default user-agent strings.
# A browser-style UA is required for all requests to succeed.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate, br",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def fetch_json(url: str) -> dict | None:
    """GET a JSON endpoint; return parsed dict or None on failure."""
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"[!] Warning: Could not fetch {url}: {e}")
        return None


def fetch_text(url: str) -> str | None:
    """GET a text endpoint; return content or None on failure."""
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        return r.text.strip()
    except Exception as e:
        print(f"[!] Warning: Could not fetch {url}: {e}")
        return None


def compute_sha256(filepath: Path) -> str:
    """Compute the SHA-256 hash of a local file."""
    sha256 = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def download_with_progress(url: str, dest: Path) -> None:
    """Stream-download a file with a live progress bar."""
    with requests.get(url, headers=HEADERS, stream=True, timeout=60) as r:
        r.raise_for_status()
        total = int(r.headers.get("Content-Length", 0))
        downloaded = 0
        bar_len = 40

        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=65536):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total:
                        pct = min(downloaded / total * 100, 100)
                        filled = int(bar_len * pct / 100)
                        bar = "#" * filled + "-" * (bar_len - filled)
                        mb_done  = downloaded / 1_048_576
                        mb_total = total / 1_048_576
                        print(
                            f"\r  [{bar}] {pct:5.1f}%  "
                            f"{mb_done:.1f}/{mb_total:.1f} MB",
                            end="", flush=True,
                        )
                    else:
                        mb_done = downloaded / 1_048_576
                        print(f"\r  Downloaded {mb_done:.1f} MB...", end="", flush=True)
    print()  # newline after progress bar


def decompress_gz(gz_path: Path, output_path: Path) -> None:
    """Decompress a .gz file."""
    print(f"[*] Decompressing to {output_path.name} ...")
    with gzip.open(gz_path, "rb") as f_in:
        with open(output_path, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)


def print_summary(output_path: Path, meta: dict | None) -> None:
    size_mb = output_path.stat().st_size / 1_048_576
    print("\n" + "=" * 60)
    print("[✓] Download complete!")
    print(f"    File  : {output_path.resolve()}")
    print(f"    Size  : {size_mb:.1f} MB")
    if meta:
        print(f"    Build : {meta.get('date', 'unknown')}  (v{meta.get('version', '?')})")
    print()
    print("  Data structure:")
    print("    AllPrintings.json")
    print("    └── data")
    print("        └── <SET_CODE>  (e.g. 'MH3', 'LTR', 'LEA')")
    print("            ├── name, releaseDate, type, ...")
    print("            └── cards[]")
    print("                └── name, manaCost, type, text, colors, ...")
    print()
    print("  Quick Python usage:")
    print("    import json")
    print("    with open('AllPrintings.json') as f:")
    print("        db = json.load(f)")
    print("    sets  = db['data']                    # dict of all sets")
    print("    cards = sets['MH3']['cards']          # list of cards in a set")
    print("    print(cards[0]['name'])")
    print("=" * 60)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Download the full MTGJSON card database (AllPrintings.json)."
    )
    parser.add_argument(
        "--output-dir", default="./mtgjson_data",
        help="Directory to save downloaded files (default: ./mtgjson_data)",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-download even if a valid file already exists",
    )
    parser.add_argument(
        "--keep-compressed", action="store_true",
        help="Keep the .gz compressed file after decompressing",
    )
    args = parser.parse_args()

    daily_folder = datetime.now().strftime("%Y-%m-%d")
    output_dir      = Path(args.output_dir) / daily_folder
    compressed_path = output_dir / COMPRESSED_FILENAME
    output_path     = output_dir / OUTPUT_FILENAME
    download_url    = f"{BASE_URL}/{COMPRESSED_FILENAME}"
    checksum_url    = download_url + ".sha256"

    output_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("  MTGJSON — Magic: The Gathering Full Card Downloader")
    print("  Source: https://mtgjson.com/api/v5/")
    print("=" * 60)

    # Step 1 — Build metadata
    meta_data = fetch_json(f"{BASE_URL}/{META_FILENAME}")
    meta = meta_data.get("data") if meta_data else None
    if meta:
        print(f"[*] MTGJSON version : {meta.get('version', '?')}")
        print(f"[*] Database built  : {meta.get('date', '?')}")

    # Step 2 — Remote checksum
    checksum_raw    = fetch_text(checksum_url)
    remote_checksum = checksum_raw.split()[0] if checksum_raw else None
    if remote_checksum:
        print(f"[*] Remote SHA-256  : {remote_checksum}")

    # Step 3 — Skip if already current
    if not args.force and compressed_path.exists() and remote_checksum:
        print(f"[*] Verifying existing file: {compressed_path.name} ...")
        local_checksum = compute_sha256(compressed_path)
        if local_checksum == remote_checksum:
            print("[✓] Already up to date — skipping download.")
            if not output_path.exists():
                decompress_gz(compressed_path, output_path)
                if not args.keep_compressed:
                    compressed_path.unlink()
            print_summary(output_path, meta)
            return
        else:
            print("[*] Outdated or corrupted — re-downloading...")

    # Step 4 — Download
    print(f"\n[*] Downloading {COMPRESSED_FILENAME} ...")
    print(f"    URL : {download_url}")
    print(f"    Dest: {compressed_path}\n")
    try:
        download_with_progress(download_url, compressed_path)
    except Exception as e:
        print(f"\n[✗] Download failed: {e}", file=sys.stderr)
        sys.exit(1)

    # Step 5 — Verify checksum
    print("[*] Verifying integrity ...")
    local_checksum = compute_sha256(compressed_path)
    if remote_checksum:
        if local_checksum == remote_checksum:
            print(f"[✓] SHA-256 verified: {local_checksum}")
        else:
            print(f"[✗] Checksum mismatch!", file=sys.stderr)
            print(f"    Expected : {remote_checksum}", file=sys.stderr)
            print(f"    Got      : {local_checksum}", file=sys.stderr)
            compressed_path.unlink(missing_ok=True)
            sys.exit(1)
    else:
        print(f"[~] Checksum unavailable (skipped). Local hash: {local_checksum}")

    # Step 6 — Decompress
    decompress_gz(compressed_path, output_path)

    # Step 7 — Optionally remove compressed file
    if not args.keep_compressed:
        compressed_path.unlink()
        print(f"[*] Removed compressed file: {compressed_path.name}")
    else:
        print(f"[*] Kept compressed file  : {compressed_path}")

    print_summary(output_path, meta)


if __name__ == "__main__":
    main()

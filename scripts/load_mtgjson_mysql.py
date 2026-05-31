#!/usr/bin/env python3
"""
load_mtgjson_mysql.py
---------------------
Loads mtgjson_data/<DATE>/AllPrintings.json into a MySQL database named 'tcg'.

Schema is derived from the MTGJSON Set / Card / Token data models. Three tables
are created if missing: `sets`, `cards`, `tokens` (plus `meta_builds` to record
each load). Re-running with the same date upserts rows via ON DUPLICATE KEY
UPDATE, so the script is idempotent.

Connection is configured via environment variables:

    MYSQL_HOST       (default: 127.0.0.1)
    MYSQL_PORT       (default: 3306)
    MYSQL_USER       (required)
    MYSQL_PASSWORD   (required — empty string is allowed)
    MYSQL_SOCKET     (optional — unix socket path, overrides host/port)

The target database is always 'tcg' and is created if it does not exist.

Usage:
    python scripts/load_mtgjson_mysql.py 2026-05-30
    python scripts/load_mtgjson_mysql.py 2026-05-30 --data-dir ./mtgjson_data
    python scripts/load_mtgjson_mysql.py 2026-05-30 --skip-images

After DB load, card images are downloaded from Scryfall into ./card_images/
using each card's MTGJSON uuid in the filename:

    card_images/{uuid}.front.jpg       (always, when scryfallId is present)
    card_images/{uuid}.back.jpg        (only for layouts with a real back face:
                                        transform, modal_dfc, meld, reversible_card)

Requirements:
    pip install pymysql requests
"""

import argparse
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date as date_type
from pathlib import Path

try:
    import pymysql
    from pymysql.constants import CLIENT
except ImportError:
    print("[X] The 'pymysql' library is required.", file=sys.stderr)
    print("    Run:  pip install pymysql", file=sys.stderr)
    sys.exit(1)

try:
    import requests
except ImportError:
    print("[X] The 'requests' library is required.", file=sys.stderr)
    print("    Run:  pip install requests", file=sys.stderr)
    sys.exit(1)


DB_NAME = "tcg"
DEFAULT_DATA_DIR = Path("mtgjson_data")
DEFAULT_IMAGES_DIR = Path("card_images")
BATCH_SIZE = 500

# Layouts where Scryfall hosts a distinct back-face image. Other multi-face
# layouts (split, adventure, aftermath, flip, ...) render both halves on a
# single face, so Scryfall has no "back" image for them.
DFC_LAYOUTS = {"transform", "modal_dfc", "meld", "reversible_card"}

SCRYFALL_IMAGE_BASE = "https://cards.scryfall.io"
SCRYFALL_IMAGE_SIZE = "large"  # 672x936
SCRYFALL_UA = (
    "mtg-loader/1.0 (local script; "
    "see scripts/load_mtgjson_mysql.py)"
)
DEFAULT_IMAGE_WORKERS = 8
DEFAULT_IMAGE_RATE = 10.0  # requests per second (Scryfall recommends ~10)


# ---------------------------------------------------------------------------
# Schema (DDL)
# ---------------------------------------------------------------------------

SETS_DDL = """
CREATE TABLE IF NOT EXISTS sets (
  code              VARCHAR(16)  NOT NULL PRIMARY KEY,
  name              VARCHAR(255) NOT NULL,
  releaseDate       VARCHAR(20),
  type              VARCHAR(64),
  block             VARCHAR(128),
  baseSetSize       INT,
  totalSetSize      INT,
  parentCode        VARCHAR(16),
  keyruneCode       VARCHAR(16),
  mtgoCode          VARCHAR(16),
  tokenSetCode      VARCHAR(16),
  mcmId             BIGINT,
  mcmIdExtras       BIGINT,
  mcmName           VARCHAR(255),
  tcgplayerGroupId  BIGINT,
  isFoilOnly        TINYINT(1),
  isOnlineOnly      TINYINT(1),
  isForeignOnly     TINYINT(1),
  isNonFoilOnly     TINYINT(1),
  isPartialPreview  TINYINT(1),
  languages         JSON,
  translations      JSON,
  booster           JSON,
  decks             JSON,
  sealedProduct     JSON,
  INDEX idx_sets_releaseDate (releaseDate),
  INDEX idx_sets_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

CARDS_DDL = """
CREATE TABLE IF NOT EXISTS cards (
  uuid                   CHAR(36)    NOT NULL PRIMARY KEY,
  setCode                VARCHAR(16) NOT NULL,
  name                   VARCHAR(512) NOT NULL,
  faceName               VARCHAR(512),
  asciiName              VARCHAR(512),
  flavorName             VARCHAR(512),
  faceFlavorName         VARCHAR(512),
  facePrintedName        VARCHAR(512),
  printedName            VARCHAR(512),
  manaCost               VARCHAR(255),
  manaValue              FLOAT,
  convertedManaCost      FLOAT,
  faceManaValue          FLOAT,
  faceConvertedManaCost  FLOAT,
  type                   VARCHAR(255),
  printedType            VARCHAR(255),
  originalType           VARCHAR(255),
  text                   TEXT,
  originalText           TEXT,
  printedText            TEXT,
  flavorText             TEXT,
  power                  VARCHAR(16),
  toughness              VARCHAR(16),
  loyalty                VARCHAR(16),
  defense                VARCHAR(16),
  hand                   VARCHAR(16),
  life                   VARCHAR(16),
  rarity                 VARCHAR(32),
  number                 VARCHAR(16),
  artist                 VARCHAR(255),
  borderColor            VARCHAR(32),
  frameVersion           VARCHAR(16),
  layout                 VARCHAR(32),
  language               VARCHAR(32),
  watermark              VARCHAR(64),
  signature              VARCHAR(255),
  securityStamp          VARCHAR(32),
  side                   VARCHAR(8),
  duelDeck               VARCHAR(16),
  originalReleaseDate    VARCHAR(20),
  edhrecRank             INT,
  edhrecSaltiness        FLOAT,
  isAlternative          TINYINT(1),
  isFullArt              TINYINT(1),
  isFunny                TINYINT(1),
  isGameChanger          TINYINT(1),
  isOnlineOnly           TINYINT(1),
  isOversized            TINYINT(1),
  isPromo                TINYINT(1),
  isRebalanced           TINYINT(1),
  isReprint              TINYINT(1),
  isReserved             TINYINT(1),
  isStorySpotlight       TINYINT(1),
  isTextless             TINYINT(1),
  isTimeshifted          TINYINT(1),
  hasAlternativeDeckLimit TINYINT(1),
  hasContentWarning      TINYINT(1),
  artistIds              JSON,
  availability           JSON,
  boosterTypes           JSON,
  cardParts              JSON,
  attractionLights       JSON,
  colorIdentity          JSON,
  colorIndicator         JSON,
  colors                 JSON,
  finishes               JSON,
  foreignData            JSON,
  frameEffects           JSON,
  identifiers            JSON,
  keywords               JSON,
  leadershipSkills       JSON,
  legalities             JSON,
  originalPrintings      JSON,
  otherFaceIds           JSON,
  printings              JSON,
  producedMana           JSON,
  promoTypes             JSON,
  purchaseUrls           JSON,
  rebalancedPrintings    JSON,
  relatedCards           JSON,
  rulings                JSON,
  skuIds                 JSON,
  sourceProducts         JSON,
  subsets                JSON,
  subtypes               JSON,
  supertypes             JSON,
  types                  JSON,
  variations             JSON,
  INDEX idx_cards_setCode (setCode),
  INDEX idx_cards_name (name(191)),
  INDEX idx_cards_rarity (rarity),
  CONSTRAINT fk_cards_set FOREIGN KEY (setCode) REFERENCES sets(code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

TOKENS_DDL = """
CREATE TABLE IF NOT EXISTS tokens (
  uuid             CHAR(36)    NOT NULL PRIMARY KEY,
  setCode          VARCHAR(16) NOT NULL,
  name             VARCHAR(512) NOT NULL,
  faceName         VARCHAR(512),
  asciiName        VARCHAR(512),
  flavorName       VARCHAR(512),
  manaCost         VARCHAR(255),
  type             VARCHAR(255),
  printedType      VARCHAR(255),
  originalType     VARCHAR(255),
  text             TEXT,
  originalText     TEXT,
  flavorText       TEXT,
  power            VARCHAR(16),
  toughness        VARCHAR(16),
  number           VARCHAR(16),
  artist           VARCHAR(255),
  borderColor      VARCHAR(32),
  frameVersion     VARCHAR(16),
  layout           VARCHAR(32),
  language         VARCHAR(32),
  watermark        VARCHAR(64),
  signature        VARCHAR(255),
  securityStamp    VARCHAR(32),
  side             VARCHAR(8),
  orientation      VARCHAR(32),
  edhrecSaltiness  FLOAT,
  isFullArt        TINYINT(1),
  isFunny          TINYINT(1),
  isOversized      TINYINT(1),
  isPromo          TINYINT(1),
  isReprint        TINYINT(1),
  isTextless       TINYINT(1),
  artistIds        JSON,
  availability     JSON,
  boosterTypes     JSON,
  colorIdentity    JSON,
  colors           JSON,
  finishes         JSON,
  frameEffects     JSON,
  identifiers      JSON,
  keywords         JSON,
  otherFaceIds     JSON,
  producedMana     JSON,
  promoTypes       JSON,
  relatedCards     JSON,
  skuIds           JSON,
  sourceProducts   JSON,
  subsets          JSON,
  subtypes         JSON,
  supertypes       JSON,
  tokenProducts    JSON,
  types            JSON,
  INDEX idx_tokens_setCode (setCode),
  INDEX idx_tokens_name (name(191)),
  CONSTRAINT fk_tokens_set FOREIGN KEY (setCode) REFERENCES sets(code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

META_DDL = """
CREATE TABLE IF NOT EXISTS meta_builds (
  buildDate   VARCHAR(20) NOT NULL PRIMARY KEY,
  version     VARCHAR(64),
  loadedAt    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""


# ---------------------------------------------------------------------------
# Column lists — drive both INSERT statements and row tuple construction.
# JSON_COLUMNS contains fields that are dicts/lists in source data and must be
# serialized to a JSON string before binding.
# ---------------------------------------------------------------------------

SET_COLUMNS = [
    "code", "name", "releaseDate", "type", "block",
    "baseSetSize", "totalSetSize",
    "parentCode", "keyruneCode", "mtgoCode", "tokenSetCode",
    "mcmId", "mcmIdExtras", "mcmName", "tcgplayerGroupId",
    "isFoilOnly", "isOnlineOnly", "isForeignOnly",
    "isNonFoilOnly", "isPartialPreview",
    "languages", "translations", "booster", "decks", "sealedProduct",
]

SET_JSON_COLUMNS = {"languages", "translations", "booster", "decks", "sealedProduct"}

CARD_COLUMNS = [
    "uuid", "setCode", "name",
    "faceName", "asciiName", "flavorName", "faceFlavorName",
    "facePrintedName", "printedName",
    "manaCost", "manaValue", "convertedManaCost",
    "faceManaValue", "faceConvertedManaCost",
    "type", "printedType", "originalType",
    "text", "originalText", "printedText", "flavorText",
    "power", "toughness", "loyalty", "defense", "hand", "life",
    "rarity", "number", "artist",
    "borderColor", "frameVersion", "layout", "language",
    "watermark", "signature", "securityStamp", "side", "duelDeck",
    "originalReleaseDate",
    "edhrecRank", "edhrecSaltiness",
    "isAlternative", "isFullArt", "isFunny", "isGameChanger",
    "isOnlineOnly", "isOversized", "isPromo", "isRebalanced",
    "isReprint", "isReserved", "isStorySpotlight", "isTextless",
    "isTimeshifted", "hasAlternativeDeckLimit", "hasContentWarning",
    "artistIds", "availability", "boosterTypes", "cardParts",
    "attractionLights", "colorIdentity", "colorIndicator", "colors",
    "finishes", "foreignData", "frameEffects", "identifiers",
    "keywords", "leadershipSkills", "legalities",
    "originalPrintings", "otherFaceIds", "printings", "producedMana",
    "promoTypes", "purchaseUrls", "rebalancedPrintings", "relatedCards",
    "rulings", "skuIds", "sourceProducts", "subsets", "subtypes",
    "supertypes", "types", "variations",
]

CARD_JSON_COLUMNS = {
    "artistIds", "availability", "boosterTypes", "cardParts",
    "attractionLights", "colorIdentity", "colorIndicator", "colors",
    "finishes", "foreignData", "frameEffects", "identifiers",
    "keywords", "leadershipSkills", "legalities",
    "originalPrintings", "otherFaceIds", "printings", "producedMana",
    "promoTypes", "purchaseUrls", "rebalancedPrintings", "relatedCards",
    "rulings", "skuIds", "sourceProducts", "subsets", "subtypes",
    "supertypes", "types", "variations",
}

TOKEN_COLUMNS = [
    "uuid", "setCode", "name",
    "faceName", "asciiName", "flavorName",
    "manaCost",
    "type", "printedType", "originalType",
    "text", "originalText", "flavorText",
    "power", "toughness", "number", "artist",
    "borderColor", "frameVersion", "layout", "language",
    "watermark", "signature", "securityStamp", "side", "orientation",
    "edhrecSaltiness",
    "isFullArt", "isFunny", "isOversized", "isPromo",
    "isReprint", "isTextless",
    "artistIds", "availability", "boosterTypes", "colorIdentity",
    "colors", "finishes", "frameEffects", "identifiers", "keywords",
    "otherFaceIds", "producedMana", "promoTypes", "relatedCards",
    "skuIds", "sourceProducts", "subsets", "subtypes", "supertypes",
    "tokenProducts", "types",
]

TOKEN_JSON_COLUMNS = {
    "artistIds", "availability", "boosterTypes", "colorIdentity",
    "colors", "finishes", "frameEffects", "identifiers", "keywords",
    "otherFaceIds", "producedMana", "promoTypes", "relatedCards",
    "skuIds", "sourceProducts", "subsets", "subtypes", "supertypes",
    "tokenProducts", "types",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def build_upsert_sql(table: str, columns: list[str]) -> str:
    """Build a parameterized INSERT ... ON DUPLICATE KEY UPDATE statement."""
    cols_csv = ", ".join(f"`{c}`" for c in columns)
    placeholders = ", ".join(["%s"] * len(columns))
    # VALUES(col) is universally supported. The 8.0.20+ alias form is cleaner
    # but raises errors on older servers, so we stick with this.
    updates = ", ".join(f"`{c}` = VALUES(`{c}`)" for c in columns if c != columns[0])
    return (
        f"INSERT INTO `{table}` ({cols_csv}) VALUES ({placeholders}) "
        f"ON DUPLICATE KEY UPDATE {updates}"
    )


def to_row(record: dict, columns: list[str], json_columns: set[str]) -> tuple:
    """Project a source dict onto an ordered tuple matching `columns`."""
    out = []
    for col in columns:
        v = record.get(col)
        if v is None:
            out.append(None)
        elif col in json_columns:
            out.append(json.dumps(v, ensure_ascii=False))
        elif isinstance(v, bool):
            out.append(1 if v else 0)
        else:
            out.append(v)
    return tuple(out)


def connect(host: str, port: int, user: str, password: str,
            unix_socket: str | None) -> pymysql.connections.Connection:
    kwargs = dict(
        user=user,
        password=password,
        charset="utf8mb4",
        autocommit=False,
        client_flag=CLIENT.MULTI_STATEMENTS,
        local_infile=False,
    )
    if unix_socket:
        kwargs["unix_socket"] = unix_socket
    else:
        kwargs["host"] = host
        kwargs["port"] = port
    return pymysql.connect(**kwargs)


def ensure_database(conn, db_name: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            f"CREATE DATABASE IF NOT EXISTS `{db_name}` "
            f"CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
        )
        cur.execute(f"USE `{db_name}`")
    conn.commit()


def ensure_schema(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(SETS_DDL)
        cur.execute(CARDS_DDL)
        cur.execute(TOKENS_DDL)
        cur.execute(META_DDL)
    conn.commit()
    apply_migrations(conn)


# Targeted ALTERs to bring existing tables up to the current DDL. Each entry is
# idempotent — MODIFY COLUMN can be re-run safely. Add new migrations here as
# the schema evolves; do not rewrite history.
MIGRATIONS = [
    # tokens.orientation: original VARCHAR(16) was too small for
    # 'horizontalstamped' (17 chars). Widen to VARCHAR(32).
    "ALTER TABLE `tokens` MODIFY COLUMN `orientation` VARCHAR(32)",
]


def apply_migrations(conn) -> None:
    with conn.cursor() as cur:
        for stmt in MIGRATIONS:
            cur.execute(stmt)
    conn.commit()


def upsert_batch(conn, sql: str, rows: list[tuple]) -> None:
    if not rows:
        return
    with conn.cursor() as cur:
        cur.executemany(sql, rows)


def load_file(conn, json_path: Path) -> dict:
    print(f"[*] Reading {json_path} ({json_path.stat().st_size / 1_048_576:.0f} MB) ...")
    with open(json_path, "r", encoding="utf-8") as f:
        db = json.load(f)

    meta = db.get("meta", {}) or {}
    data = db.get("data", {}) or {}
    print(f"[*] MTGJSON build {meta.get('date', '?')} (v{meta.get('version', '?')})")
    print(f"[*] {len(data)} sets to load")

    set_sql = build_upsert_sql("sets", SET_COLUMNS)
    card_sql = build_upsert_sql("cards", CARD_COLUMNS)
    token_sql = build_upsert_sql("tokens", TOKEN_COLUMNS)

    total_cards = 0
    total_tokens = 0
    set_count = 0

    for set_code, set_obj in data.items():
        # The card/token records carry setCode but the set object itself may not
        # include it under the same key — make sure it's set.
        set_obj_for_row = dict(set_obj)
        set_obj_for_row.setdefault("code", set_code)

        set_row = to_row(set_obj_for_row, SET_COLUMNS, SET_JSON_COLUMNS)
        upsert_batch(conn, set_sql, [set_row])

        cards = set_obj.get("cards") or []
        for i in range(0, len(cards), BATCH_SIZE):
            chunk = cards[i:i + BATCH_SIZE]
            rows = [to_row(c, CARD_COLUMNS, CARD_JSON_COLUMNS) for c in chunk]
            upsert_batch(conn, card_sql, rows)
        total_cards += len(cards)

        tokens = set_obj.get("tokens") or []
        for i in range(0, len(tokens), BATCH_SIZE):
            chunk = tokens[i:i + BATCH_SIZE]
            rows = [to_row(t, TOKEN_COLUMNS, TOKEN_JSON_COLUMNS) for t in chunk]
            upsert_batch(conn, token_sql, rows)
        total_tokens += len(tokens)

        conn.commit()
        set_count += 1
        if set_count % 25 == 0 or set_count == len(data):
            print(f"    [{set_count:4d}/{len(data)}] {set_code:>8s}  "
                  f"cards+={len(cards):4d}  tokens+={len(tokens):3d}  "
                  f"(running: {total_cards} cards, {total_tokens} tokens)")

    # Record the build we loaded.
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO meta_builds (buildDate, version) VALUES (%s, %s) "
            "ON DUPLICATE KEY UPDATE version = VALUES(version), "
            "loadedAt = CURRENT_TIMESTAMP",
            (meta.get("date"), meta.get("version")),
        )
    conn.commit()

    print()
    print("=" * 60)
    print(f"[OK] Loaded {set_count} sets, {total_cards} cards, {total_tokens} tokens")
    print(f"     into database `{DB_NAME}`")
    print("=" * 60)

    return db


# ---------------------------------------------------------------------------
# Image downloads (Scryfall)
# ---------------------------------------------------------------------------


class RateLimiter:
    """Token-bucket style global rate limiter shared across worker threads."""

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


def scryfall_image_url(scryfall_id: str, face: str) -> str:
    c1, c2 = scryfall_id[0], scryfall_id[1]
    return (
        f"{SCRYFALL_IMAGE_BASE}/{SCRYFALL_IMAGE_SIZE}/{face}/"
        f"{c1}/{c2}/{scryfall_id}.jpg"
    )


def download_one(session: requests.Session, limiter: RateLimiter,
                 url: str, dest: Path, retries: int = 3) -> str:
    """Download URL to dest atomically.

    Returns one of: 'ok', 'skip', 'miss' (404), or 'err:<msg>'.
    """
    if dest.exists() and dest.stat().st_size > 0:
        return "skip"

    tmp = dest.with_suffix(dest.suffix + ".tmp")
    last_err = None
    for attempt in range(retries):
        limiter.wait()
        try:
            r = session.get(url, timeout=30)
        except requests.RequestException as e:
            last_err = type(e).__name__
            time.sleep(1 + attempt)
            continue

        if r.status_code == 200:
            tmp.write_bytes(r.content)
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


def download_images(db: dict, images_dir: Path, workers: int,
                    rate_per_sec: float) -> None:
    images_dir.mkdir(parents=True, exist_ok=True)

    tasks: list[tuple[str, str, Path]] = []  # (scryfallId, face, dest)
    for set_obj in (db.get("data") or {}).values():
        for card in set_obj.get("cards") or []:
            uuid = card.get("uuid")
            scryfall_id = (card.get("identifiers") or {}).get("scryfallId")
            if not uuid or not scryfall_id or len(scryfall_id) < 2:
                continue
            tasks.append((scryfall_id, "front", images_dir / f"{uuid}.front.jpg"))
            if (card.get("layout") or "") in DFC_LAYOUTS:
                tasks.append((scryfall_id, "back", images_dir / f"{uuid}.back.jpg"))

    if not tasks:
        print("[*] No image downloads queued.")
        return

    print()
    print("=" * 60)
    print(f"[*] Image downloads: {len(tasks):,} tasks  "
          f"(workers={workers}, rate~{rate_per_sec:g}/s)")
    print(f"    Dest: {images_dir.resolve()}")
    print("=" * 60)

    limiter = RateLimiter(rate_per_sec)
    session = requests.Session()
    session.headers.update({"User-Agent": SCRYFALL_UA, "Accept": "image/jpeg,*/*"})

    counts = {"ok": 0, "skip": 0, "miss": 0, "err": 0}
    counts_lock = threading.Lock()
    sample_errors: list[str] = []

    def work(task):
        scryfall_id, face, dest = task
        url = scryfall_image_url(scryfall_id, face)
        result = download_one(session, limiter, url, dest)
        kind = "err" if result.startswith("err:") else result
        with counts_lock:
            counts[kind] += 1
            if kind == "err" and len(sample_errors) < 5:
                sample_errors.append(f"{url}  ->  {result}")
        return result

    progress_step = max(500, len(tasks) // 40)
    try:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = [ex.submit(work, t) for t in tasks]
            done = 0
            for _ in as_completed(futures):
                done += 1
                if done % progress_step == 0 or done == len(tasks):
                    with counts_lock:
                        c = dict(counts)
                    print(f"    [{done:>6,d}/{len(tasks):,d}]  "
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

def parse_date(s: str) -> str:
    try:
        date_type.fromisoformat(s)
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"date must be YYYY-MM-DD: {e}")
    return s


def require_env(name: str, default: str | None = None, allow_empty: bool = False) -> str:
    v = os.environ.get(name, default)
    if v is None or (not allow_empty and v == ""):
        print(f"[X] Missing required env variable: {name}", file=sys.stderr)
        sys.exit(2)
    return v


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Load mtgjson_data/<DATE>/AllPrintings.json into MySQL "
                    "database 'tcg'.",
    )
    parser.add_argument("date", type=parse_date,
                        help="Date folder under --data-dir, e.g. 2026-05-30")
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR),
                        help=f"Root data directory (default: {DEFAULT_DATA_DIR})")
    parser.add_argument("--images-dir", default=str(DEFAULT_IMAGES_DIR),
                        help=f"Where to save card images "
                             f"(default: {DEFAULT_IMAGES_DIR})")
    parser.add_argument("--skip-images", action="store_true",
                        help="Skip downloading card images from Scryfall")
    parser.add_argument("--image-workers", type=int,
                        default=DEFAULT_IMAGE_WORKERS,
                        help=f"Concurrent image downloads "
                             f"(default: {DEFAULT_IMAGE_WORKERS})")
    parser.add_argument("--image-rate", type=float,
                        default=DEFAULT_IMAGE_RATE,
                        help=f"Global image-download rate, req/s "
                             f"(default: {DEFAULT_IMAGE_RATE})")
    args = parser.parse_args()

    json_path = Path(args.data_dir) / args.date / "AllPrintings.json"
    if not json_path.is_file():
        print(f"[X] Not found: {json_path}", file=sys.stderr)
        sys.exit(1)

    host = os.environ.get("MYSQL_HOST", "127.0.0.1")
    port = int(os.environ.get("MYSQL_PORT", "3306"))
    user = require_env("MYSQL_USER")
    password = require_env("MYSQL_PASSWORD", allow_empty=True)
    unix_socket = os.environ.get("MYSQL_SOCKET") or None

    print("=" * 60)
    print("  MTGJSON -> MySQL loader")
    print(f"  Source : {json_path}")
    if unix_socket:
        print(f"  MySQL  : socket {unix_socket}  user={user}")
    else:
        print(f"  MySQL  : {host}:{port}  user={user}")
    print(f"  Target : database `{DB_NAME}`")
    print("=" * 60)

    conn = connect(host, port, user, password, unix_socket)
    try:
        ensure_database(conn, DB_NAME)
        ensure_schema(conn)
        db = load_file(conn, json_path)
    finally:
        conn.close()

    if not args.skip_images:
        download_images(
            db,
            images_dir=Path(args.images_dir),
            workers=args.image_workers,
            rate_per_sec=args.image_rate,
        )


if __name__ == "__main__":
    main()

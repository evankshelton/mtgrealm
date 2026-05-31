#!/usr/bin/env python3
"""
load_scryfall.py
----------------
Loads Scryfall card data from scryfall_data/<DATE>/ into a MySQL database.

Two tables are created if missing:
    sets    — set metadata loaded from sets.json
    cards   — every print from all_cards.json (streamed; the file is 2 GB+)
Plus a load_meta table that records each successful load.

Key-stability guarantee
-----------------------
Both tables use Scryfall's own UUIDs as primary keys (`cards.id`,
`sets.id`). Loading is performed with INSERT ... ON DUPLICATE KEY UPDATE so
existing rows are updated in place and their PKs never change. The script
NEVER deletes rows. As a result, image filenames keyed by Scryfall id and
any external links referencing card ids keep working across re-loads.

Usage
-----
    python load_scryfall.py 2026-05-30
    python load_scryfall.py 2026-05-30 --data-dir ./scryfall_data

Connection — env vars (auto-loaded from .env if python-dotenv is installed)
    MYSQL_HOST       default 127.0.0.1
    MYSQL_PORT       default 3306
    MYSQL_USER       required
    MYSQL_PASSWORD   required (empty allowed)
    MYSQL_SOCKET     optional unix socket; overrides host/port
    MYSQL_DATABASE   default 'scryfall'

Requirements:
    pip install -r requirements.txt
"""

import argparse
import json
import os
import sys
import time
from datetime import date as date_type
from decimal import Decimal
from pathlib import Path

# Optional .env support — load before reading env vars.
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    import pymysql
    from pymysql.constants import CLIENT
except ImportError:
    print("[X] 'pymysql' is required. Run: pip install -r requirements.txt",
          file=sys.stderr)
    sys.exit(1)

try:
    import ijson
except ImportError:
    print("[X] 'ijson' is required. Run: pip install -r requirements.txt",
          file=sys.stderr)
    sys.exit(1)


DEFAULT_DB_NAME = "scryfall"
DEFAULT_DATA_DIR = Path("./scryfall_data")
BATCH_SIZE = 500


# ---------------------------------------------------------------------------
# DDL
# ---------------------------------------------------------------------------

SETS_DDL = """
CREATE TABLE IF NOT EXISTS sets (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  code            VARCHAR(16)  NOT NULL,
  name            VARCHAR(255) NOT NULL,
  set_type        VARCHAR(64),
  released_at     DATE,
  block_code      VARCHAR(16),
  block           VARCHAR(128),
  parent_set_code VARCHAR(16),
  card_count      INT,
  printed_size    INT,
  digital         TINYINT(1),
  foil_only       TINYINT(1),
  nonfoil_only    TINYINT(1),
  mtgo_code       VARCHAR(16),
  arena_code      VARCHAR(16),
  tcgplayer_id    BIGINT,
  scryfall_uri    VARCHAR(512),
  uri             VARCHAR(512),
  icon_svg_uri    VARCHAR(512),
  search_uri      VARCHAR(512),
  UNIQUE KEY uk_sets_code (code),
  INDEX idx_sets_released_at (released_at),
  INDEX idx_sets_type (set_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

CARDS_DDL = """
CREATE TABLE IF NOT EXISTS cards (
  id                   CHAR(36)     NOT NULL PRIMARY KEY,
  oracle_id            CHAR(36),
  name                 VARCHAR(512) NOT NULL,
  lang                 VARCHAR(8)   NOT NULL,
  layout               VARCHAR(32),
  released_at          DATE,

  set_id               CHAR(36),
  set_code             VARCHAR(16),
  set_name             VARCHAR(255),
  set_type             VARCHAR(64),
  collector_number     VARCHAR(32),
  rarity               VARCHAR(32),

  cmc                  FLOAT,
  mana_cost            VARCHAR(128),
  type_line            VARCHAR(255),
  oracle_text          TEXT,
  power                VARCHAR(16),
  toughness            VARCHAR(16),
  loyalty              VARCHAR(16),
  defense              VARCHAR(16),
  life_modifier        VARCHAR(16),
  hand_modifier        VARCHAR(16),
  edhrec_rank          INT,
  penny_rank           INT,

  artist               VARCHAR(255),
  flavor_text          TEXT,
  flavor_name          VARCHAR(255),
  printed_name         VARCHAR(512),
  printed_text         TEXT,
  printed_type_line    VARCHAR(255),
  border_color         VARCHAR(32),
  frame                VARCHAR(16),
  card_back_id         CHAR(36),
  illustration_id      CHAR(36),
  watermark            VARCHAR(64),
  security_stamp       VARCHAR(32),
  image_status         VARCHAR(32),

  reserved             TINYINT(1),
  reprint              TINYINT(1),
  variation            TINYINT(1),
  variation_of         CHAR(36),
  oversized            TINYINT(1),
  promo                TINYINT(1),
  digital              TINYINT(1),
  full_art             TINYINT(1),
  textless             TINYINT(1),
  booster              TINYINT(1),
  story_spotlight      TINYINT(1),
  highres_image        TINYINT(1),
  content_warning      TINYINT(1),
  foil                 TINYINT(1),
  nonfoil              TINYINT(1),

  arena_id             BIGINT,
  mtgo_id              BIGINT,
  mtgo_foil_id         BIGINT,
  tcgplayer_id         BIGINT,
  tcgplayer_etched_id  BIGINT,
  cardmarket_id        BIGINT,

  uri                  VARCHAR(512),
  scryfall_uri         VARCHAR(512),
  rulings_uri          VARCHAR(512),
  prints_search_uri    VARCHAR(512),

  colors               JSON,
  color_identity       JSON,
  color_indicator      JSON,
  keywords             JSON,
  produced_mana        JSON,
  finishes             JSON,
  games                JSON,
  frame_effects        JSON,
  promo_types          JSON,
  attraction_lights    JSON,
  multiverse_ids       JSON,
  artist_ids           JSON,
  legalities           JSON,
  image_uris           JSON,
  prices               JSON,
  related_uris         JSON,
  purchase_uris        JSON,
  card_faces           JSON,
  all_parts            JSON,
  preview              JSON,

  INDEX idx_cards_oracle_id (oracle_id),
  INDEX idx_cards_set_id (set_id),
  INDEX idx_cards_set_code (set_code),
  INDEX idx_cards_name (name(191)),
  INDEX idx_cards_lang (lang),
  INDEX idx_cards_released_at (released_at),
  INDEX idx_cards_rarity (rarity),
  INDEX idx_cards_tcgplayer_id (tcgplayer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

LOAD_META_DDL = """
CREATE TABLE IF NOT EXISTS load_meta (
  load_date    VARCHAR(20) NOT NULL PRIMARY KEY,
  cards_loaded BIGINT,
  sets_loaded  INT,
  loaded_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""


# ---------------------------------------------------------------------------
# Column lists — drive both DDL and row tuple construction.
# JSON_COLUMNS: serialize lists/dicts to JSON strings.
# BOOL_COLUMNS: coerce to 1/0 even when the source emits truthy/falsy values.
# FIELD_MAP: map column name -> source dict key when they differ.
# ---------------------------------------------------------------------------

SET_COLUMNS = [
    "id", "code", "name", "set_type", "released_at",
    "block_code", "block", "parent_set_code",
    "card_count", "printed_size",
    "digital", "foil_only", "nonfoil_only",
    "mtgo_code", "arena_code", "tcgplayer_id",
    "scryfall_uri", "uri", "icon_svg_uri", "search_uri",
]
SET_JSON_COLUMNS: set[str] = set()
SET_BOOL_COLUMNS = {"digital", "foil_only", "nonfoil_only"}
SET_FIELD_MAP: dict[str, str] = {}

CARD_COLUMNS = [
    "id", "oracle_id", "name", "lang", "layout", "released_at",
    "set_id", "set_code", "set_name", "set_type", "collector_number", "rarity",
    "cmc", "mana_cost", "type_line", "oracle_text",
    "power", "toughness", "loyalty", "defense",
    "life_modifier", "hand_modifier",
    "edhrec_rank", "penny_rank",
    "artist", "flavor_text", "flavor_name",
    "printed_name", "printed_text", "printed_type_line",
    "border_color", "frame", "card_back_id", "illustration_id",
    "watermark", "security_stamp", "image_status",
    "reserved", "reprint", "variation", "variation_of",
    "oversized", "promo", "digital", "full_art", "textless", "booster",
    "story_spotlight", "highres_image", "content_warning",
    "foil", "nonfoil",
    "arena_id", "mtgo_id", "mtgo_foil_id",
    "tcgplayer_id", "tcgplayer_etched_id", "cardmarket_id",
    "uri", "scryfall_uri", "rulings_uri", "prints_search_uri",
    "colors", "color_identity", "color_indicator",
    "keywords", "produced_mana", "finishes", "games", "frame_effects",
    "promo_types", "attraction_lights", "multiverse_ids", "artist_ids",
    "legalities", "image_uris", "prices", "related_uris", "purchase_uris",
    "card_faces", "all_parts", "preview",
]

CARD_JSON_COLUMNS = {
    "colors", "color_identity", "color_indicator",
    "keywords", "produced_mana", "finishes", "games", "frame_effects",
    "promo_types", "attraction_lights", "multiverse_ids", "artist_ids",
    "legalities", "image_uris", "prices", "related_uris", "purchase_uris",
    "card_faces", "all_parts", "preview",
}

CARD_BOOL_COLUMNS = {
    "reserved", "reprint", "variation",
    "oversized", "promo", "digital", "full_art", "textless", "booster",
    "story_spotlight", "highres_image", "content_warning",
    "foil", "nonfoil",
}

# Column name -> source field name. Only used where they differ.
# `set` is reserved-ish in SQL; we store it as `set_code`.
CARD_FIELD_MAP = {
    "set_code": "set",
}

# Date-typed columns. Convert "" -> NULL so MySQL doesn't reject the row.
DATE_COLUMNS = {"released_at"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def build_upsert_sql(table: str, columns: list[str]) -> str:
    cols_csv = ", ".join(f"`{c}`" for c in columns)
    placeholders = ", ".join(["%s"] * len(columns))
    # Update every column except the PK on conflict. VALUES(col) is universally
    # supported (the 8.0.20+ alias form is cleaner but breaks on older servers).
    updates = ", ".join(
        f"`{c}` = VALUES(`{c}`)" for c in columns if c != columns[0]
    )
    return (
        f"INSERT INTO `{table}` ({cols_csv}) VALUES ({placeholders}) "
        f"ON DUPLICATE KEY UPDATE {updates}"
    )


def _json_default(o):
    # ijson decodes JSON numbers as Decimal to preserve precision; stdlib
    # json.dumps doesn't know how to encode those. Convert to float here.
    if isinstance(o, Decimal):
        return float(o)
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")


def to_row(record: dict, columns: list[str], json_columns: set[str],
           bool_columns: set[str], field_map: dict[str, str]) -> tuple:
    out = []
    for col in columns:
        src = field_map.get(col, col)
        v = record.get(src)
        if v is None:
            out.append(None)
        elif col in json_columns:
            out.append(json.dumps(v, ensure_ascii=False, default=_json_default))
        elif col in bool_columns:
            out.append(1 if v else 0)
        elif isinstance(v, bool):
            out.append(1 if v else 0)
        elif col in DATE_COLUMNS and isinstance(v, str) and v == "":
            out.append(None)
        elif isinstance(v, (list, dict)):
            # Defensive — a complex value landed on a non-JSON column.
            # Serialize rather than crash.
            out.append(json.dumps(v, ensure_ascii=False, default=_json_default))
        else:
            out.append(v)
    return tuple(out)


# ---------------------------------------------------------------------------
# Connection / schema
# ---------------------------------------------------------------------------

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
        cur.execute(LOAD_META_DDL)
    conn.commit()


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------

def load_sets(conn, sets_path: Path) -> int:
    if not sets_path.is_file():
        print(f"[!] No sets.json at {sets_path} — skipping sets phase.")
        return 0

    print(f"[*] Loading sets from {sets_path.name} ...")
    with open(sets_path, "r", encoding="utf-8") as f:
        payload = json.load(f)
    sets = payload.get("data") or []

    sql = build_upsert_sql("sets", SET_COLUMNS)
    rows = [
        to_row(s, SET_COLUMNS, SET_JSON_COLUMNS, SET_BOOL_COLUMNS, SET_FIELD_MAP)
        for s in sets
    ]

    with conn.cursor() as cur:
        for i in range(0, len(rows), BATCH_SIZE):
            cur.executemany(sql, rows[i:i + BATCH_SIZE])
    conn.commit()
    print(f"[OK] sets: upserted {len(rows):,} rows.")
    return len(rows)


def load_cards(conn, cards_path: Path) -> int:
    if not cards_path.is_file():
        print(f"[X] No all_cards.json at {cards_path}", file=sys.stderr)
        sys.exit(1)

    size_mb = cards_path.stat().st_size / 1_048_576
    print(f"[*] Streaming cards from {cards_path.name} ({size_mb:.0f} MB) ...")

    sql = build_upsert_sql("cards", CARD_COLUMNS)
    batch: list[tuple] = []
    total = 0
    start = time.monotonic()

    with open(cards_path, "rb") as f, conn.cursor() as cur:
        for card in ijson.items(f, "item"):
            row = to_row(
                card, CARD_COLUMNS,
                CARD_JSON_COLUMNS, CARD_BOOL_COLUMNS, CARD_FIELD_MAP,
            )
            batch.append(row)
            if len(batch) >= BATCH_SIZE:
                cur.executemany(sql, batch)
                conn.commit()
                total += len(batch)
                batch.clear()
                if total % (BATCH_SIZE * 20) == 0:
                    elapsed = time.monotonic() - start
                    rate = total / elapsed if elapsed > 0 else 0
                    print(f"    {total:>9,d} cards  "
                          f"({rate:,.0f}/s, {elapsed:.0f}s elapsed)")
        if batch:
            cur.executemany(sql, batch)
            conn.commit()
            total += len(batch)

    elapsed = time.monotonic() - start
    print(f"[OK] cards: upserted {total:,} rows in {elapsed:.0f}s "
          f"({total/elapsed:,.0f}/s).")
    return total


def record_load(conn, load_date: str, cards_n: int, sets_n: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO load_meta (load_date, cards_loaded, sets_loaded) "
            "VALUES (%s, %s, %s) "
            "ON DUPLICATE KEY UPDATE cards_loaded = VALUES(cards_loaded), "
            "sets_loaded = VALUES(sets_loaded), "
            "loaded_at = CURRENT_TIMESTAMP",
            (load_date, cards_n, sets_n),
        )
    conn.commit()


# ---------------------------------------------------------------------------
# Main / CLI
# ---------------------------------------------------------------------------

def parse_date(s: str) -> str:
    try:
        date_type.fromisoformat(s)
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"date must be YYYY-MM-DD: {e}")
    return s


def require_env(name: str, default: str | None = None,
                allow_empty: bool = False) -> str:
    v = os.environ.get(name, default)
    if v is None or (not allow_empty and v == ""):
        print(f"[X] Missing required env variable: {name}", file=sys.stderr)
        sys.exit(2)
    return v


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Load Scryfall card data into MySQL.",
    )
    parser.add_argument("date", type=parse_date,
                        help="Date folder under --data-dir, e.g. 2026-05-30")
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR),
                        help=f"Root data directory (default: {DEFAULT_DATA_DIR})")
    parser.add_argument("--skip-sets", action="store_true",
                        help="Skip the sets phase.")
    parser.add_argument("--skip-cards", action="store_true",
                        help="Skip the cards phase.")
    args = parser.parse_args()

    folder = Path(args.data_dir) / args.date
    sets_path = folder / "sets.json"
    cards_path = folder / "all_cards.json"

    host = os.environ.get("MYSQL_HOST", "127.0.0.1")
    port = int(os.environ.get("MYSQL_PORT", "3306"))
    user = require_env("MYSQL_USER")
    password = require_env("MYSQL_PASSWORD", allow_empty=True)
    unix_socket = os.environ.get("MYSQL_SOCKET") or None
    db_name = os.environ.get("MYSQL_DATABASE", DEFAULT_DB_NAME)

    print("=" * 60)
    print("  Scryfall -> MySQL loader")
    print(f"  Source : {folder}")
    if unix_socket:
        print(f"  MySQL  : socket {unix_socket}  user={user}")
    else:
        print(f"  MySQL  : {host}:{port}  user={user}")
    print(f"  Target : database `{db_name}`")
    print("=" * 60)

    conn = connect(host, port, user, password, unix_socket)
    try:
        ensure_database(conn, db_name)
        ensure_schema(conn)

        sets_n = 0 if args.skip_sets else load_sets(conn, sets_path)
        cards_n = 0 if args.skip_cards else load_cards(conn, cards_path)
        record_load(conn, args.date, cards_n, sets_n)
    finally:
        conn.close()

    print()
    print("=" * 60)
    print(f"[OK] Load complete for {args.date}: "
          f"{cards_n:,} cards, {sets_n:,} sets.")
    print("=" * 60)


if __name__ == "__main__":
    main()

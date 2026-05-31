# scryfall

Standalone downloader for MTG card data from the [Scryfall API](https://scryfall.com/docs/api). Pulls raw bulk + reference data into a date-stamped folder. Processing happens elsewhere.

## What it downloads

- **All Cards** bulk file — every printing in every language (~2 GB decompressed).
- **`/sets`** — full set list with metadata.
- **`/symbology`** — all mana / cost symbols.
- **`/catalog/*`** — 19 catalogs (creature types, keyword abilities, watermarks, etc.).
- **Card images** — `large` JPEGs from Scryfall, one per printing, for every language. DFC fronts and backs are saved separately. Skip with `--skip-images`.

## Quick start

```bash
cd scryfall
pip install -r requirements.txt

# 1. Pull data from Scryfall
python download_scryfall.py

# 2. (optional) Load it into MySQL
cp .env.example .env && $EDITOR .env   # fill in MYSQL_USER/PASSWORD
python load_scryfall.py 2026-05-30
```

First run for the day downloads everything into `scryfall_data/<today>/`. Subsequent runs skip files that already exist (use `--force` to re-fetch).

## Output layout

```
scryfall_data/
└── 2026-05-30/
    ├── all_cards.json          ← bulk "All Cards" payload
    ├── all_cards.meta.json     ← Scryfall manifest entry (drives skip logic)
    ├── sets.json               ← /sets (paginated, flattened to one file)
    ├── symbology.json          ← /symbology
    └── catalogs/
        ├── card-names.json
        ├── creature-types.json
        ├── keyword-abilities.json
        └── ... (one file per catalog)

scryfall_images/                ← NOT date-stamped; images are immutable per Scryfall id
├── {c1}/{c2}/                  ← sharded by first two chars of the Scryfall UUID
│   ├── {scryfall_id}.large.jpg
│   ├── {scryfall_id}.front.large.jpg   ← DFC fronts (transform, modal_dfc, ...)
│   └── {scryfall_id}.back.large.jpg
└── card_backs/{c1}/{c2}/{card_back_id}.large.jpg
                                ← back-design images (one per unique card_back_id,
                                  e.g. default Magic back, Planechase backs, ...)
```

## Flags

| Flag | Behavior |
|---|---|
| `--output-dir PATH` | Root output dir (default `./scryfall_data`). |
| `--force` | Re-download everything; ignore same-day and cross-day skips. |
| `--keep-compressed` | Keep `all_cards.json.gz` after decompression. |
| `--skip-bulk` | Skip the All Cards file (only fetch aux endpoints). |
| `--skip-aux` | Skip `/sets`, `/symbology`, and `/catalog/*` (only fetch bulk). |
| `--skip-images` | Skip card-image downloads. |
| `--images-dir PATH` | Image output root (default `./scryfall_images`). |
| `--image-sizes` | Comma-separated sizes (default `large`). Valid: `small,normal,large,png,art_crop,border_crop`. |
| `--image-langs` | Comma-separated language filter, e.g. `en` or `en,ja`. Empty = all (default). |
| `--image-workers N` | Concurrent image downloads (default 8). |
| `--image-rate R` | Global image rate, req/s (default 10). |

## Skip / reuse behavior

- **Same-day skip.** If `<today>/all_cards.json` exists and its sidecar `all_cards.meta.json` has the same `updated_at` as the live manifest, the file is left alone.
- **Cross-day reuse.** Before downloading the bulk file, the script scans prior day folders for an `all_cards.meta.json` whose `updated_at` matches the current manifest. If a match is found, the existing `all_cards.json` is hard-linked into today's folder (falling back to `shutil.copy2` across filesystems). This avoids redundant ~2 GB downloads when Scryfall hasn't updated.
- Auxiliary endpoint files (`sets.json`, `symbology.json`, `catalogs/*.json`) are skipped if they already exist in today's folder.

`--force` disables both skip paths.

## Notes

- Identifies via `User-Agent`, sets `Accept: application/json`, and sleeps 100 ms between API calls per [Scryfall's request guidelines](https://scryfall.com/docs/api).
- All outputs are written via a `.tmp` sibling then renamed — Ctrl-C never leaves a half file.
- Scryfall does not publish checksums for bulk data, so there is no SHA-256 verification step. The downloader trusts the HTTP response.

## MySQL loader (`load_scryfall.py`)

Loads `scryfall_data/<DATE>/all_cards.json` and `sets.json` into a MySQL database (default `scryfall`). Two tables — `cards` and `sets` — are created if missing, plus a `load_meta` audit table. The bulk JSON is streamed with `ijson`, so memory stays small even on the 2 GB+ file. Cards are upserted in batches of 500 via `INSERT ... ON DUPLICATE KEY UPDATE`.

**Key-stability guarantee.** Both tables use Scryfall's own UUIDs as primary keys (`cards.id`, `sets.id`). The loader never deletes rows — on re-load, existing rows are updated in place and their primary keys never change. Image filenames keyed by Scryfall id (`scryfall_images/{c1}/{c2}/{id}.large.jpg`) and any external links referencing card ids remain valid across re-loads.

### Configuration

Connection is read from environment variables. A `.env` file in the working directory is auto-loaded (see `.env.example`):

| Env var | Default | Notes |
|---|---|---|
| `MYSQL_HOST` | `127.0.0.1` | |
| `MYSQL_PORT` | `3306` | |
| `MYSQL_USER` | *(required)* | |
| `MYSQL_PASSWORD` | *(required, empty allowed)* | |
| `MYSQL_SOCKET` | *(none)* | If set, overrides host/port. |
| `MYSQL_DATABASE` | `scryfall` | Database is created if missing. |

### Usage

```bash
python load_scryfall.py 2026-05-30                 # full load
python load_scryfall.py 2026-05-30 --skip-sets     # cards only
python load_scryfall.py 2026-05-30 --skip-cards    # sets only
python load_scryfall.py 2026-05-30 --data-dir /alt # different data root
```

### Schema overview

- **`cards`** — one row per print (Scryfall card object). 82 columns: typed columns for the queryable fields (name, set_code, rarity, cmc, type_line, oracle_text, prices via JSON, image_uris via JSON, etc.) and JSON columns for nested structures (`legalities`, `image_uris`, `prices`, `card_faces`, `all_parts`, `preview`, ...). Indexed on `oracle_id`, `set_id`, `set_code`, `name(191)`, `lang`, `released_at`, `rarity`, and `tcgplayer_id`.
- **`sets`** — one row per Scryfall set. `id` PK, `code` unique.
- **`load_meta`** — one row per date loaded with row counts and timestamp.

There is no foreign-key constraint between `cards` and `sets` — joins use `cards.set_id = sets.id`. Avoiding the FK keeps the loader robust to edge cases where a card references a set not yet in the sets payload, and keeps the "never delete" guarantee uncomplicated.

## Image downloads

- Images are sourced directly from `image_uris` (or `card_faces[].image_uris` for DFCs) on each Scryfall card object — no URL construction.
- Images are stored **outside** `scryfall_data/<date>/` because they're immutable per Scryfall ID. A given `{scryfall_id}.large.jpg` is correct forever; date-stamping it would just duplicate disk usage.
- The script skips any file that already exists with non-zero size, so re-runs incrementally fill in newly added prints. Rate-limited globally (10 req/s default) and parallelized across 8 worker threads. Honors `Retry-After` on 429s.
- **Expected scale:** ~110k unique prints in English, ~5x more across all languages. At `large` (~150 KB/image) that's ~20–100 GB depending on languages. The first full run takes hours; subsequent runs are fast because almost everything skips.
- **Licensing:** card art is owned by Wizards of the Coast. Scryfall permits redistribution for non-commercial / fan-content uses with attribution. Commercial uses (e.g. running a marketplace) should be checked against Wizards' [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy) and Scryfall's [usage guidelines](https://scryfall.com/docs/api).

See `CLAUDE.md` for design context and future-update notes.

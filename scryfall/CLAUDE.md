# scryfall — Claude context

Project-level notes for future Claude sessions working in this directory. End-user docs live in `README.md`.

## Scope and boundaries

- **Download + load.** Two scripts: `download_scryfall.py` fetches from Scryfall, `load_scryfall.py` upserts the downloaded JSON into MySQL. Image hosting / serving and any application-layer querying live in other projects.
- **Standalone.** `requirements.txt` is self-contained; everything runs from `cd scryfall && pip install -r requirements.txt && python <script>.py`.
- Do not add features beyond download + load (e.g. ETL transforms, business logic, search indexing). Those belong in sibling projects.

## File layout

```
scryfall/
├── CLAUDE.md             — this file
├── README.md             — user-facing usage docs
├── requirements.txt      — deps: requests, ijson, pymysql, python-dotenv
├── .env.example          — template for .env (gitignored)
├── .gitignore            — ignores scryfall_data/, scryfall_images/, .env, venvs, caches
├── download_scryfall.py  — Scryfall -> disk
├── load_scryfall.py      — disk -> MySQL
├── scryfall_data/        — created at runtime, gitignored
│   └── <YYYY-MM-DD>/
│       ├── all_cards.json
│       ├── all_cards.meta.json
│       ├── sets.json
│       ├── symbology.json
│       └── catalogs/
│           └── <name>.json
└── scryfall_images/      — created at runtime, gitignored
    ├── {c1}/{c2}/        — sharded by first two chars of Scryfall UUID
    │   ├── {scryfall_id}.large.jpg
    │   ├── {scryfall_id}.front.large.jpg    (DFC fronts)
    │   └── {scryfall_id}.back.large.jpg     (DFC backs)
    └── card_backs/{c1}/{c2}/{card_back_id}.large.jpg  (back designs; deduped)
```

## What gets fetched and why

- **Bulk: All Cards** (`type=all_cards`) — every printing in every language. The user explicitly chose this over the smaller bulk types because they want foreign-language and full-print coverage. Size is ~2 GB decompressed; Scryfall serves it gzipped over the wire.
- **`/sets`, `/symbology`** — paginated `List` endpoints. The script follows `next_page` and flattens to a single file per endpoint.
- **`/catalog/*` (19 endpoints)** — listed in the `CATALOGS` constant in `download_scryfall.py`. Catalogs are single-response (not paginated).
- **Card images** — `large` JPEGs, one per print (no dedup), all languages by default. Intended for self-hosting (deck-builder UI, marketplace). Additional sizes available via `--image-sizes`. Skippable via `--skip-images`.

## Key design decisions

- **Date-stamped folders** (`scryfall_data/<YYYY-MM-DD>/`). Chosen so historical snapshots are preserved. Matches the sibling `../mtgjson_data/<date>/` layout.
- **Cross-day reuse via hard-link.** Before re-downloading the ~2 GB bulk file, the script scans prior day folders for an `all_cards.meta.json` whose `updated_at` matches Scryfall's current manifest. On match it hard-links the prior `all_cards.json` into today's folder (`os.link`, falling back to `shutil.copy2` across filesystems). This is important — Scryfall updates the bulk file roughly daily, but not always, and re-downloading 2 GB when nothing changed is wasteful.
- **Two-stage bulk download (`.json.gz` → `.json`).** The bulk URL is served with `Content-Encoding: gzip` and `Content-Length` reports the *compressed* size. To keep an accurate progress bar, the script disables transport-level decompression (`r.raw.decode_content = False`), streams compressed bytes to disk, then decompresses with `gzip` as a second step. The `.gz` is removed unless `--keep-compressed`.
- **Atomic writes.** Every output file is written to a sibling `*.tmp` path and renamed at the end. Interrupted runs never leave partial files.
- **Polite to Scryfall.** Identifying `User-Agent`, `Accept: application/json`, and 100 ms (`REQUEST_DELAY_S`) between API calls — per Scryfall's [request guidelines](https://scryfall.com/docs/api).
- **No SHA-256 verification.** Scryfall does not publish checksums for bulk data (unlike MTGJSON), so the script trusts the HTTP response. Do not add a checksum step that hashes downloaded bytes against an imagined remote checksum — there is no remote checksum to compare against.
- **Images live outside `scryfall_data/<date>/`.** They go in `./scryfall_images/{c1}/{c2}/...` regardless of the run date, because `(scryfall_id, size)` is immutable — a given file is correct forever. Date-stamping would just balloon disk usage. The bulk JSON for any date references those images by id.
- **Image dir sharded by first two UUID chars.** Mirrors Scryfall's own URL pattern (`https://cards.scryfall.io/large/front/{c1}/{c2}/{id}.jpg`). Keeps any one directory to ~1000 files. Don't flatten this.
- **Images are streamed from the bulk file with `ijson`.** Never `json.load` the 2 GB+ bulk file. The image task iterator (`iter_image_tasks`) materializes a list of `(url, dest)` tuples — at ~1M tasks × ~150 B that's ~150 MB, acceptable. If memory pressure ever matters here, switch to a producer/consumer queue feeding the ThreadPoolExecutor.
- **DFC handling via `card_faces[].image_uris`.** Scryfall puts image URIs EITHER on the card OR on each face, not both. The script prefers per-face when any face has `image_uris`. Files are named `{id}.front.{size}.jpg` / `{id}.back.{size}.jpg` (and `face2`, `face3`, ... if needed — rare). Don't try to infer from `layout`; the JSON tells us directly.
- **Card-back designs live at a different host.** URL pattern is `https://backs.scryfall.io/{size}/{c1}/{c2}/{card_back_id}.jpg` (constant: `SCRYFALL_BACKS_BASE`). Saved under `card_backs/{c1}/{c2}/...`. DFCs have `card_back_id: null` and are correctly skipped — their "back" is a real card-face image. The default Magic back UUID (`0aeebaf5-...`) is shared by almost every normal card, so `iter_image_tasks` dedups via a `seen_backs` set — that image only enqueues once per run. Don't try `cards.scryfall.io/back/...` for `card_back_id`; it 404s. Don't try `?face=back` on a non-DFC; it 422s.

## Conventions / gotchas

- The All Cards file is huge. Never `json.load` it inside this project — there is no consumer here, and the file's only purpose is to be handed off to downstream tools. Streaming is mandatory for any new functionality that touches it.
- `--force` disables *both* the same-day skip and the cross-day reuse. Same-day skip alone has no flag — it's always on unless `--force`.
- The bulk-data manifest's `size` field is the *decompressed* size in bytes. `Content-Length` from the HTTP response is the *compressed* size. The script uses Content-Length for the progress bar; do not swap in `size` from the manifest.
- Pagination logic in `fetch_following_pagination` preserves the first page's wrapper keys (object type, etc.) but rewrites `data`, drops `next_page`, and sets `has_more: false`. If you add an endpoint that uses a different list-wrapper shape, double-check the merge logic.
- `CATALOGS` is a hand-curated list. If Scryfall adds a new catalog endpoint, add its slug to that constant.

## How to extend

- **New bulk type** (e.g. also fetch `default_cards`): generalize `BULK_TYPE` to a list, loop in `main()`. Each type already gets its own `<type>.json` + `<type>.meta.json` files so multiple types coexist cleanly.
- **New catalog**: append the slug to `CATALOGS`.
- **New aux endpoint**: add a call site in `main()`. Use `download_list_endpoint` for `List` responses and `download_catalog`-style direct save for one-shot responses.
- **Compression toggle**: `--keep-compressed` already exists for the bulk file; mirror the pattern if a future feature streams another large file.

## Loader (`load_scryfall.py`)

- **Tables.** `cards` (one row per print), `sets`, `load_meta`. Schema in the DDL constants near the top of the script. Cards has 82 columns: scalar fields broken out, nested fields (`legalities`, `prices`, `image_uris`, `card_faces`, `all_parts`, `preview`, etc.) stored as `JSON`.
- **PKs are Scryfall UUIDs.** `cards.id = CHAR(36)`, `sets.id = CHAR(36)`. This is load-bearing: external systems (image filenames, deep links) reference these ids and must not break across reloads.
- **Pure upsert, never delete.** `INSERT ... ON DUPLICATE KEY UPDATE` updates every non-PK column on conflict. Rows that fall out of upstream Scryfall data are kept. Do not add a "prune missing" pass — it would void the key-stability guarantee.
- **No FK between cards.set_id and sets.id.** Indexed only. Avoids brittle ordering issues if Scryfall ever ships a card referencing a set not yet in the sets payload, and keeps "never delete" simple.
- **`set` is renamed to `set_code` in the schema.** `set` is reserved-adjacent in SQL and confusing in Python. The `CARD_FIELD_MAP` constant in the loader handles the column-name → source-key mapping. If new Scryfall fields ever clash with SQL keywords, extend `CARD_FIELD_MAP` rather than touching `to_row`.
- **Streaming with ijson.** Never `json.load` `all_cards.json` — it's 2 GB+. The loader iterates with `ijson.items(f, 'item')` and batches 500 rows per `executemany`. Commits per batch so a Ctrl-C never wedges the transaction.
- **`.env` autoload.** `dotenv.load_dotenv()` runs at import time if `python-dotenv` is installed. The script also runs fine with plain env vars; dotenv is optional.
- **Database name is configurable via `MYSQL_DATABASE`**, defaulting to `scryfall`. Distinct from the legacy `tcg` database used by the now-retiring MTGJSON loader, so the two can coexist during the migration. The script `CREATE DATABASE IF NOT EXISTS`s it.
- **Date columns coerce `""` → NULL.** Some upstream records emit empty-string dates, which MySQL would reject. `DATE_COLUMNS` in the loader lists the affected columns.

### Loader: things NOT to do

- Don't add a DELETE / TRUNCATE / pruning step. Pure upsert is the explicit invariant.
- Don't switch the PK to an auto-increment surrogate. External references depend on Scryfall ids being the primary key.
- Don't add a FK from `cards.set_id` to `sets.id`. Tested and intentionally absent.
- Don't load to a different DB by hard-coding the name — use `MYSQL_DATABASE`.

## What NOT to do

- Don't add a parse / load / transform step. That belongs in a separate sibling project.
- Don't switch the output format away from JSON. Downstream consumers expect plain JSON.
- Don't remove the User-Agent or pacing — Scryfall has been generous about access but documented their expectations.
- Don't make the script dependent on parent-repo files (no `../mtgjson_data` references, no shared utils). It must remain runnable from a clone of just this directory.

# api — Claude context

Go HTTP API for the MTG project. Pairs with `../web/` (Next.js) and reads card data populated by `../scryfall/load_scryfall.py`.

## Scope and boundaries

- **HTTP + DB only.** This service authenticates users, queries `cards`/`canonical_cards`/`sets`, and (in later iterations) writes collection / deck / marketplace data. It does not download from Scryfall, generate images, or do background processing — that lives in `../scryfall/`.
- Standalone Go module. `go.mod` declares all deps; no parent-directory imports.

## Stack

- **chi** for routing, stdlib `net/http` for the server.
- **sqlx** + `go-sql-driver/mysql`. No ORM by design — explicit SQL is easier to reason about against MySQL JSON columns and the FK constraints we already have.
- **golang-migrate** for schema, driven via the `migrate` CLI from the `Makefile`.
- **argon2id** (`golang.org/x/crypto/argon2`) for password hashing. Parameters in `internal/auth/argon2.go` follow OWASP 2024 recommendations.
- **Opaque session tokens** in httpOnly cookies. The DB stores the sha256 hash of the token (never the raw token); the cookie carries the raw value. Revoking = setting `revoked_at`.
- **godotenv** auto-loads `.env`.

## File layout

```
api/
├── cmd/server/main.go        — entrypoint
├── internal/
│   ├── config/               — env -> Config struct
│   ├── db/                   — sqlx open + ping
│   ├── auth/                 — argon2, sessions, signup/login/logout, middleware
│   ├── cards/                — search + print/detail handlers
│   ├── httpx/                — JSON / error helpers
│   └── server/               — chi route assembly + stubs.go
├── migrations/               — golang-migrate SQL pairs
└── Makefile                  — run / build / migrate targets
```

## Key design decisions

- **golang-migrate owns all schema** — including the four pre-existing tables (`cards`, `sets`, `canonical_cards`, `load_meta`). `0001_baseline_existing.up.sql` recreates them with `CREATE TABLE IF NOT EXISTS` so it's safe to apply to a fresh DB, and for the existing populated DB we use `migrate force 1` to mark it applied without re-running. **`load_scryfall.py` should no longer create these tables** going forward — it just upserts data into the migration-managed schema.
- **The baseline migration's `down` is a no-op.** Dropping `cards`/`sets` would discard months of Scryfall data. If you need to truly reset, do it manually.
- **Session tokens are stored hashed.** Raw token in cookie, `sha256(raw)` stored as `sessions.id`. Compromise of the DB does not leak active sessions. Don't change this to store the raw token — that's a deliberate hardening choice.
- **`auth.Optional` middleware runs on every route** so handlers can read `auth.FromContext(ctx)` to know whether the request is signed in. `auth.Required` 401s if no user. Don't combine into one — public-but-personalized pages (e.g. search results that highlight cards in your collection) need Optional.
- **Card endpoints are public.** `/cards/search`, `/cards/oracle/{oracle_id}`, `/cards/{id}` do not require auth. Feature endpoints (`/collections/*`, `/decks/*`, `/store/*`, `/marketplace/*`) all sit behind `auth.Required`. The marketplace browse endpoint is currently auth-required to avoid scraping during v1; relax when ready to go public.
- **No FK from `cards.set_id → sets.id`.** Intentionally absent (see `../scryfall/CLAUDE.md`). Joins use this column with an index. Don't add the FK.
- **FK from `collection_items.card_id → cards(id)` is `ON DELETE RESTRICT`.** We never delete card rows anyway (key-stability guarantee for external image filenames), and RESTRICT makes the invariant explicit.
- **Money is stored as integer cents (BIGINT) + ISO-4217 currency.** Never float. See migration `0005_marketplace`.
- **Card-condition column is named `card_condition`, not `condition`.** `CONDITION` is a MySQL reserved word and the un-prefixed name fails to parse. `lang` (matching `cards.lang`) is used instead of `language` for the same kind of consistency-and-safety reasoning. If you add a new column, double-check against the MySQL 8 reserved word list before committing.
- **Same-origin in dev via Next.js rewrite.** The browser hits `/api/...` and Next proxies to `:8080`. This lets `Lax` session cookies work without cross-origin complications. CORS config in `internal/server/server.go` only matters if you call the API directly from JS.

## Migrations bootstrap (existing DB)

```bash
make migrate-force-baseline   # one-time: mark 0001 as applied
make migrate-up               # apply 0002+
```

For a fresh DB just `make migrate-up`.

## How to extend

- **New feature** (collections / decks / marketplace CRUD): add a package under `internal/<feature>/`, mirror the `cards` pattern (`Handler` struct, methods, sqlx queries). Replace the corresponding `notImplemented(...)` stubs in `server.go`.
- **New migration**: add `NNNN_name.up.sql` + `NNNN_name.down.sql` to `migrations/`. Filenames must be sequentially numbered.
- **New table referencing cards**: prefer FK with `ON DELETE RESTRICT` to preserve key stability.
- **New auth feature** (email verification, password reset, 2FA): add tables in a new migration, handlers in `internal/auth/`. Argon2 params live in `argon2.go` — bump there if you ever change them (and write a migration to rehash on next login).

## What NOT to do

- Don't add an ORM. Stay with sqlx + raw SQL.
- Don't drop the session-hash design — store hashes, not raw tokens.
- Don't add a FK on `cards.set_id → sets.id`. (See above.)
- Don't bring schema creation back into `load_scryfall.py` — Go migrations are now authoritative.
- Don't use float for currency anywhere. Cents-as-BIGINT + ISO-4217 string.
- Don't add the `0001_baseline_existing.down.sql` rollback. It's intentionally a no-op.

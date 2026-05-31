# mtg-api

Go HTTP API serving the MTG card data (`canonical_cards`, `cards`, `sets`) plus auth, collections, decks, and marketplace functionality. Pairs with the Next.js front-end at `../web/`.

## Stack

- **chi** router, stdlib `net/http`
- **sqlx** over `database/sql` + `go-sql-driver/mysql`
- **golang-migrate** for schema (CLI-driven)
- **argon2id** password hashing, opaque session tokens in httpOnly cookies
- **godotenv** for `.env` autoload

## First-time setup

```bash
cd api
cp .env.example .env && $EDITOR .env   # set MYSQL_USER / MYSQL_PASSWORD
go mod download
```

Install the `migrate` CLI:

```bash
brew install golang-migrate
# or: go install -tags 'mysql' github.com/golang-migrate/migrate/v4/cmd/migrate@latest
```

### Migration bootstrap

The first migration (`0001_baseline_existing`) recreates the four tables that already exist in the `tcg` database from earlier work (`cards`, `sets`, `canonical_cards`, `load_meta`). It uses `CREATE TABLE IF NOT EXISTS`, so applying it to a populated DB does no damage — but the cleaner path is to tell migrate the baseline is already applied:

```bash
make migrate-force-baseline   # one-time on existing DB
make migrate-up               # apply 0002–0005 (auth, collections, decks, marketplace)
```

On a fresh database, just:

```bash
make migrate-up
```

### Run the server

```bash
make run     # listens on :8080 by default
```

Health check:

```bash
curl localhost:8080/healthz
```

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/healthz` | — | Process liveness. |
| POST | `/api/v1/auth/signup` | — | `{email, password, display_name?}`. Issues session cookie. |
| POST | `/api/v1/auth/login` | — | `{email, password}`. Issues session cookie. |
| POST | `/api/v1/auth/logout` | optional | Revokes the session, clears cookie. |
| GET | `/api/v1/auth/me` | required | Current user. |
| GET | `/api/v1/cards/search` | — | Query params: `q`, `color`, `rarity`, `set`, `page`, `limit`, `order`. Hits `canonical_cards`. |
| GET | `/api/v1/cards/oracle/{oracle_id}` | — | Search-shaped row from `canonical_cards`. |
| GET | `/api/v1/cards/oracle/{oracle_id}/prints` | — | All printings of an oracle (default English; `?lang=all` or `?lang=ja`). |
| GET | `/api/v1/cards/{id}` | — | Single print row from `cards`. |
| `/api/v1/collections/*` | required | Stubbed — returns 501. |
| `/api/v1/decks/*` | required | Stubbed — returns 501. |
| `/api/v1/store/*` | required | Stubbed — returns 501. |
| `/api/v1/marketplace/*` | required | Stubbed — returns 501. |

## Layout

```
api/
├── cmd/server/main.go        — process entrypoint
├── internal/
│   ├── config/               — env loading
│   ├── db/                   — sqlx connection
│   ├── auth/                 — argon2, sessions, signup/login handlers, middleware
│   ├── cards/                — search + print detail handlers
│   ├── httpx/                — JSON / error helpers
│   └── server/               — chi route assembly + stubs
└── migrations/               — golang-migrate SQL files
```

See `CLAUDE.md` for design context.

# mtg-web

Next.js (App Router) frontend for the MTG project. Talks to the Go API at `../api/`.

## Stack

- **Next.js 15** App Router, React 19
- **TypeScript**
- **Tailwind CSS** + **shadcn/ui** components (Radix primitives)
- **@tanstack/react-query** for client-side fetches
- **Zod** available for form validation

## Setup

```bash
cd web
cp .env.local.example .env.local   # set NEXT_PUBLIC_API_BASE
npm install
npm run dev                        # http://localhost:3000
```

The Go API must be running at `NEXT_PUBLIC_API_BASE` (defaults to `http://localhost:8080`). Next.js rewrites `/api/*` requests to the Go API so the browser sees a single origin and session cookies work without CORS contortions.

## Pages

| Route | Auth | Status |
|---|---|---|
| `/` | — | Marketing landing. |
| `/login`, `/signup` | — | Sign in / create account. |
| `/dashboard` | required | Shortcuts to feature areas. |
| `/cards` | — | Card search (hits `canonical_cards`). |
| `/cards/[oracle_id]` | — | Card detail + printings list. |
| `/collection` | required | Stub. |
| `/decks` | required | Stub. |
| `/marketplace` | required | Stub. |
| `/store` | required | Stub. |

See `CLAUDE.md` for design notes.

# web — Claude context

Next.js (App Router) frontend for the MTG project. Pairs with `../api/` (Go).

## Scope and boundaries

- **UI + client-side data fetching only.** Authoritative data lives in the Go API. The web project does not connect to MySQL or do any heavy computation — it renders.
- Standalone npm project. No imports from sibling directories.

## Stack

- **Next.js 15** App Router, React 19, TypeScript strict.
- **Tailwind CSS** + **shadcn/ui** Radix-based primitives. Primitives live in `src/components/ui/` and are owned in-repo (no runtime UI library dep — copy-pasted from shadcn). New primitives added via `npx shadcn add <name>`.
- **@tanstack/react-query** for client fetches with caching.
- **Zod** available for form/data validation (not heavily used yet).

## File layout

```
web/
├── src/
│   ├── app/                 — App Router pages
│   │   ├── layout.tsx       — Root layout (Providers + Nav)
│   │   ├── providers.tsx    — QueryClient + AuthProvider wrappers
│   │   ├── page.tsx         — Landing
│   │   ├── login/, signup/  — Auth pages
│   │   ├── dashboard/       — Auth-gated home for signed-in users
│   │   ├── cards/           — Search + [oracle_id] detail
│   │   ├── collection/, decks/, marketplace/, store/   — Stubs (ComingSoon)
│   ├── components/
│   │   ├── nav.tsx          — Top navigation w/ sign-in state
│   │   ├── auth-form.tsx    — Shared login/signup form
│   │   ├── coming-soon.tsx  — Placeholder for stubbed feature pages
│   │   └── ui/              — shadcn primitives (button, card, input, label)
│   └── lib/
│       ├── api.ts           — typed fetch wrapper + response types
│       ├── auth.tsx         — AuthProvider + useAuth() hook
│       └── utils.ts         — cn() helper for Tailwind class merging
├── next.config.mjs          — rewrites /api/* → Go API
└── tsconfig.json            — strict, @ alias for src/
```

## Key design decisions

- **Same-origin /api/\* via Next.js rewrites.** `next.config.mjs` rewrites `/api/:path*` to `${NEXT_PUBLIC_API_BASE}/api/:path*`. The browser sees a single origin, so the Go API's `Lax` session cookies just work — no CORS complications. Don't change `lib/api.ts` to hit the API origin directly without re-validating cookie behavior.
- **AuthProvider runs `GET /auth/me` once on mount.** That sets the user / loading state. `useAuth()` exposes `user`, `loading`, `refresh()`, `signOut()`. Pages that need a signed-in user check `user` and redirect to `/login` in a `useEffect`. We don't use middleware-based route protection because the auth signal lives in an httpOnly cookie that Next middleware can't decode without an API call.
- **Auth-gated pages render `null` while loading**, then redirect if no user. This avoids the "flash of public content" issue. `ComingSoon` and `DashboardPage` both follow this pattern — copy it for new auth-gated pages.
- **Card search hits `canonical_cards` via the API.** One row per `oracle_id`. The detail page (`/cards/[oracle_id]`) fetches both the canonical row and the per-print list (`/cards/oracle/{oracle_id}/prints`) — search the canon, drill into prints.
- **Card images come from Scryfall's CDN** via the URLs in `image_uris` (large / normal / etc.). The app does NOT serve images from `../scryfall_images/`. If/when we move to self-hosted images, swap the URL in one place and add a CDN config. `next.config.mjs` `images.remotePatterns` allowlists `cards.scryfall.io` and `backs.scryfall.io`.
- **shadcn primitives are owned, not imported.** They live in `src/components/ui/`. To add new ones run `npx shadcn add <name>`. Don't switch to importing a runtime UI library — that's a one-way door away from shadcn's per-component customization model.

## How to extend

- **New page**: add a folder under `src/app/<route>/page.tsx`. Use `"use client"` if you need hooks. For auth-gated pages, copy the `ComingSoon` redirect pattern.
- **New API call**: extend `lib/api.ts` with a typed response shape; use via React Query's `useQuery` / `useMutation`.
- **New shadcn primitive**: `npx shadcn add <name>` from this directory. It writes into `src/components/ui/` per `components.json`.

## What NOT to do

- Don't hit the Go API directly from the browser at `localhost:8080` — go through the `/api/*` rewrite so cookies work.
- Don't store auth tokens in localStorage or React state. The session lives in an httpOnly cookie; the AuthProvider only tracks "is there a user" via `/auth/me`.
- Don't import from `../api/` or `../scryfall/`. The web project must remain runnable from a clone of just this directory + a reachable API.
- Don't introduce a runtime UI library (MUI, Mantine, NextUI). Stay on shadcn — that's the documented choice and means component code is in-repo.
- Don't use `<img>` blindly — Next's `<Image>` is preferred for production. The current pages use `<img>` for simplicity; convert when polishing.

# Technology Stack

**scoutpack** — a Troop 10 scout gear tracker. One-liner: a TypeScript
serverless app — React/Vite SPA + Hono on Cloudflare Workers, D1 (SQLite) for
data, Cloudflare Access (Slack SSO) for auth. Served same-origin at
`troop10rwc.org/gearlist`.

## Runtime & hosting
- **Cloudflare Workers** — the whole app (API + static assets) runs at the edge,
  deployed via **Wrangler**, served at `troop10rwc.org/gearlist*` (Worker route).
- **Cloudflare Workers Static Assets** (`ASSETS` binding, single-page-application
  fallback) serves the built frontend. The Worker owns the whole `/gearlist/*`
  subpath: strips the base prefix, routes `/api/*` to Hono, else serves assets.

## Backend
- **Hono** (TypeScript) — HTTP framework for the Worker; REST API under `/api/*`.
- **Cloudflare D1** (serverless SQLite) — two databases:
  - `scoutpack` — the app's normalized schema (accounts, scouts, closet_items,
    templates, template_items, packing_lists, packing_list_items). Managed
    with **Wrangler D1 migrations** (`migrations/`).
  - `events-db` — the existing troop calendar/events database, attached
    **read-only** via a `remote: true` binding.
- No ORM — hand-written SQL via the D1 client.

## Frontend
- **React 19** + **Vite 6** SPA, TypeScript, hand-written CSS (no UI framework).
- **`@cloudflare/vite-plugin`** — runs the Worker in the Workers runtime during
  `vite dev` and produces the deploy bundle. Vite `base: "/gearlist/"`.
- Client routing/auth gating done manually (no router library).

## Auth
- **Cloudflare Access** (Zero Trust) with **Slack** as the identity provider —
  authenticates at the edge for the whole domain. The Worker **verifies the
  Access JWT** (RS256 via the team JWKS, **WebCrypto**) and reads identity
  (`src/worker/auth.ts`). No app-level login. `DEV_AUTH_BYPASS=1` for local dev.
- **Roles** — a configurable Access group claim (`LEADER_GROUP`) marks
  template editors. Default users are scouts/parents; group members are
  leaders.

## External integrations
- None. The troop events DB lives in the same Cloudflare account; the gear
  Worker reads it via a `remote: true` D1 binding. Cross-DB joins aren't
  supported in D1, so each side is queried separately and joined in code.

## Tooling & language
- **TypeScript** end-to-end with shared types (`src/shared/`) between client and
  worker. Split `tsconfig` project references for DOM/client vs. Workers/worker
  environments; `tsc -b` for type-checking.
- **npm**; **git** → GitHub (`troop10rwc/scoutpack`).

See `README.md` for setup and the production deploy runbook.

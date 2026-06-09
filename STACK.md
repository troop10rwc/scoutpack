# Technology Stack

**scoutpack** — a Troop 10 scout gear tracker. One-liner: a TypeScript
serverless app — React/Vite SPA + Hono on Cloudflare Workers, D1 (SQLite) for
data, Cloudflare Access (Slack SSO) for auth. Served same-origin at
`troop10rwc.org/manage/gearlist`.

## Runtime & hosting
- **Cloudflare Workers** — the whole app (API + static assets) runs at the edge,
  deployed via **Wrangler**, served at `troop10rwc.org/manage/gearlist*` (Worker route).
- **Cloudflare Workers Static Assets** (`ASSETS` binding, single-page-application
  fallback) serves the built frontend. The Worker owns the whole `/manage/gearlist/*`
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
  `vite dev` and produces the deploy bundle. Vite `base: "/manage/gearlist/"`.
- Client routing/auth gating done manually (no router library).

## Auth
- **Cloudflare Access** (Zero Trust) with **Slack** as the identity provider —
  authenticates at the edge for the whole domain. The Worker **verifies the
  Access JWT** (RS256 via the team JWKS, **WebCrypto**) and reads identity
  (`src/worker/auth.ts`). No app-level login. `DEV_AUTH_BYPASS=1` for local dev.
- **Roles** — driven by the externally-managed **roster DB** (`ROSTER` binding,
  read-only; `src/worker/rosterdb.ts`), not the OIDC claim. A user's email is
  matched against `adult_members.email` / `youth_members.emails` and their BSA
  `positions` decide access: Scoutmaster, Assistant Scoutmaster, Crew Advisor,
  Assistant Crew Advisor, Senior Patrol Leader, or Troop Admin confer "leader"
  (template/event editing + role management). Resolution (`src/worker/roster.ts`)
  is three-layered, highest first: (1) a manual **override** in scoutpack's
  `member_roles` table, set by leaders on the **Roster** page (`#/roster`) for
  people not on the roster or to grant/revoke ahead of an import; (2) the roster
  DB positions; (3) the Access `LEADER_GROUP` claim as a bootstrap fallback so
  the troop is never locked out. A force-"Scout" override revokes a roster/group
  leader; you can't revoke your own access.

## External integrations
- The troop **events** and **roster** DBs live in the same Cloudflare account;
  the gear Worker reads each via a `remote: true` D1 binding (read-only).
  Cross-DB joins aren't supported in D1, so each side is queried separately and
  joined in code.

## Tooling & language
- **TypeScript** end-to-end with shared types (`src/shared/`) between client and
  worker. Split `tsconfig` project references for DOM/client vs. Workers/worker
  environments; `tsc -b` for type-checking.
- **npm**; **git** → GitHub (`troop10rwc/scoutpack`).

See `README.md` for setup and the production deploy runbook.

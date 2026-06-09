# scoutpack

Troop 10 scout gear tracker — per-scout closets, leader-curated packing-list
templates per trip type, calendar-aware "what am I missing for this event".

Served same-origin at `troop10rwc.org/manage/gearlist`. See [`STACK.md`](./STACK.md)
for the tech stack overview.

## Setup

Foundational types (`Role`, `Position`, `LEADER_POSITIONS`, `Identity`) come
from `@troop10rwc/shared`, which publishes to **GitHub Packages** (not npmjs).
The committed `.npmrc` sets the registry and interpolates the auth token from
the `NPM_TOKEN` environment variable — so every environment provides the token
the same way: as a `read:packages`-scoped classic GitHub PAT in `$NPM_TOKEN`.

**Local dev** — export it from your shell profile, e.g. `~/.zshrc`:

```bash
export NPM_TOKEN=ghp_yourTokenHere
```

(Or use `direnv` with a gitignored `.envrc`.) A token sitting only in
`~/.npmrc` will *not* work — the repo `.npmrc` interpolates `${NPM_TOKEN}` to
empty/literal and the registry rejects with 401.

**Cloudflare's git-integrated build** — add `NPM_TOKEN` as a build env var
(secret) on the Worker's dashboard. No build-command customization needed;
Cloudflare's auto `npm clean-install` reads the repo `.npmrc` and picks up the
token via env interpolation.

**GitHub Actions** — set `NPM_TOKEN: ${{ secrets.GITHUB_TOKEN }}` on the job,
or use `actions/setup-node@v4` with `registry-url` + `always-auth: true`.

```bash
npm install
# One-time: create the gear database in Cloudflare.
wrangler d1 create scoutpack
# Paste the returned database_id into wrangler.jsonc.
# Same for events-db: set its database_name + database_id.

# Apply migrations locally.
npm run db:migrate:local
npm run db:seed:local
```

Create `.dev.vars` for local development:

```
DEV_AUTH_BYPASS=1
# Optional: stand in for Access LEADER_GROUP membership. This is only the
# last-resort *fallback* — the roster DB (matched by DEV_AUTH_EMAIL) and any
# member_roles override take precedence, just like in production.
# DEV_AUTH_EMAIL=you@yourtroop.org   # use a real roster email to test roles
# DEV_AUTH_ROLE=leader
```

## Roles & roster

A member's role comes from the troop **roster DB** (`ROSTER` binding,
read-only — the externally-managed BSA import), not the OIDC claim. On login the
user's email is matched against `adult_members.email` / `youth_members.emails`,
and their `positions` decide access. Holding any of these BSA titles confers
**leader** (packing-list templates, event tagging, role management):

> Scoutmaster · Assistant Scoutmaster · Crew Advisor · Assistant Crew Advisor ·
> Senior Patrol Leader · Troop Admin

Resolution has three layers, highest precedence first:

1. **Override** — a manual entry in scoutpack's own `member_roles` table, set by
   leaders on the **Roster** page (`#/roster`). Use it to grant access to
   someone not yet on the roster, or "Scout — revoke access" to remove a
   roster/group leader. (You can't revoke your own access.)
2. **Roster DB** — the BSA positions above.
3. **Access `LEADER_GROUP` claim** — a bootstrap fallback so the troop is never
   locked out before the roster is wired up.

See `src/worker/roster.ts` (resolution) and `src/worker/rosterdb.ts` (roster
queries).

Run:

```bash
npm run dev
# open http://localhost:5173/manage/gearlist/
```

## Deploy

```bash
npm run db:migrate:remote
npm run deploy
```

## Events database assumption

The Worker reads upcoming events from a separate D1 (`EVENTS` binding,
read-only). It expects a table named `events` with at minimum these columns:

```sql
id          TEXT/INTEGER  -- primary key
name        TEXT          -- event title
start_at    TEXT/INTEGER  -- ISO datetime or unix seconds
end_at      TEXT/INTEGER  -- optional
event_type  TEXT          -- 'summer_camp' | 'car_camping' | 'backpacking' | 'day_hike'
```

If your schema uses different column names, adjust the query in
`src/worker/events.ts`.

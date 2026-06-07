# scoutpack

Troop 10 scout gear tracker — per-scout closets, leader-curated packing-list
templates per trip type, calendar-aware "what am I missing for this event".

Served same-origin at `troop10rwc.org/gearlist`. See [`STACK.md`](./STACK.md)
for the tech stack overview.

## Setup

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
# Optional: stand in for Access LEADER_GROUP membership. This is the *fallback*
# role — assigning the dev user a position in the Roster page (member_roles)
# overrides it, just like in production.
# DEV_AUTH_ROLE=leader
```

## Roles & roster

A member's role comes from the **roster** (`member_roles` table), not the OIDC
claim. Leaders manage it on the **Roster** page (`#/roster`): assign each member
a position — Scoutmaster, Assistant Scoutmaster, Crew Advisor, Assistant Crew
Advisor, Senior Patrol Leader, or Scout. The five leadership positions get
leader access (packing-list templates, event tagging, and editing roles).

If a member has no position assigned, they fall back to the Cloudflare Access
`LEADER_GROUP` claim — so the troop is never locked out before anyone is
assigned. An explicit position always wins over the group (assign an explicit
"Scout — override group" to demote someone who is in `LEADER_GROUP`). See
`src/worker/roster.ts`.

Run:

```bash
npm run dev
# open http://localhost:5173/gearlist/
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

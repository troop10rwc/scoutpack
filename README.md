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
# Optional: change the dev user role:
# DEV_AUTH_ROLE=leader
```

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

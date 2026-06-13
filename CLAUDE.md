# CLAUDE.md

Guidance for working in **scoutpack**. Read [`STACK.md`](./STACK.md) for the
architecture and [`README.md`](./README.md) for setup/runbook; this file
captures the recurring *workflow* — the things we do on nearly every change.

## Validation loop (do this on every change)

- There is **no test suite**. The validation loop is `npm run typecheck`
  (`tsc -b`) + the preview deploy. Run `npm run typecheck` after edits and
  before opening/declaring done — it's the primary gate.
- Don't ask the user to check manually. When a change is browser-observable,
  verify it yourself on the dev server (`npm run dev`, app at
  `http://localhost:5173/manage/gearlist/`) or the PR preview, then report.

## Branch / PR / merge workflow

Every feature ships as its own PR — this is the default unit of work.

1. Branch off `main` with a short descriptive **kebab-case** name describing the
   change (e.g. `delete-event-binding`, `recommended-gear-wishlist`,
   `closet-add-items-autocomplete`). Not `claude/*` for normal feature work.
2. `npm run typecheck`, then commit, `git push -u`, `gh pr create`.
3. The user reviews on the **preview URL** (see below), iterates, then says
   "merge the pr".
4. **Squash-merge**: `gh pr merge --squash`. This repo always squash-merges.

## Preview URLs (`preview_urls: true`)

PR builds produce a `*.workers.dev` preview that the user almost always wants
("what's the preview url?"). To find it, read the comment the
**`cloudflare-workers-and-pages`** bot posts on the PR:

```bash
gh pr view <N> --repo troop10rwc/scoutpack --json comments \
  --jq '.comments[] | select(.author.login=="cloudflare-workers-and-pages") | .body' | tail -20
```

The preview host is the commit SHA: `<sha-prefix>-scoutpack.tactical.workers.dev`.
The build takes a bit — poll the PR checks / bot comment rather than guessing.

[`wrangler.jsonc`](./wrangler.jsonc) is the **source of truth** for preview
behavior (`preview_urls`, routes, bindings, vars). Configure previews there and
let the build pick it up — don't reach for dashboard/CLI one-offs that drift
from the committed config.

## Database changes (D1)

- Schema lives in sequentially numbered, **append-only** migrations:
  `migrations/NNNN_name.sql`. Add a new file for any schema change; never edit a
  committed one. D1 binding is `DB`, database name `scoutpack`.
- Apply **local first, then remote** — the user routinely asks to "run the
  migration" / "push to the remote database":
  ```bash
  npm run db:migrate:local      # wrangler d1 migrations apply scoutpack --local
  npm run db:migrate:remote     # ... --remote   (production)
  ```
- `EVENTS` (calendar-db) and `ROSTER` (roster-db) are **read-only**,
  externally-managed, `remote: true` bindings. Don't write to them or add
  migrations for them. D1 has no cross-DB joins — query each side and join in
  code (`src/worker/events.ts`, `rosterdb.ts`, `roster.ts`).
- Hand-written SQL via the D1 client — **no ORM**.

## Shared kit (`@troop10rwc/*`)

- `@troop10rwc/shared` (types), `@troop10rwc/ui` (back-office components/styles),
  `@troop10rwc/worker-kit` (Access JWT verify) come from **GitHub Packages** and
  are the source of truth — **reuse them, don't redefine types or re-style
  components**. Install needs `NPM_TOKEN` (see README).
- The kit lives in a separate repo (`~/Projects/troop10kit`). The recurring
  cross-repo flow when a shared change is needed: make it in the kit repo →
  PR/merge → **bump the version & release** there → bump the dependency here.
- For UI/back-office work, consult the **`backoffice-style`** and
  **`consume-kit`** skills — they're the design contract.
- `src/client/App.tsx` uses an AppShell API; don't revert it (see memory note).

## UI conventions (from repeated review feedback)

When building list/table views (closet, templates, event detail), the user
consistently wants:
- The **description** column to take the most room; other columns
  (qty, weight, worn/consumable) left/right-justified and sized to fit content.
- **Autocomplete** inputs over plain dropdowns; allow ad-hoc entries.
- **Inline-editable text**, not boxy text inputs, in dense edit panes.
- A **pill/icon** to show state (e.g. in-closet vs. missing) rather than a wide column.
- Emphasis on **drag-and-drop** (closet → missing items) with clear drop targets.
- Quantities need only ~2 digits of width.

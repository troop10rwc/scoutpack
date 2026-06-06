-- Scoutpack: schema for per-scout gear closets and per-event packing lists.
-- One D1 database; events live in a separate read-only D1 (EVENTS binding).

PRAGMA foreign_keys = ON;

-- One row per Cloudflare Access identity that has logged in.
-- A single account can manage multiple scout profiles (parent with several kids).
CREATE TABLE accounts (
  id         TEXT PRIMARY KEY,                       -- uuid
  email      TEXT NOT NULL UNIQUE,                   -- from Access JWT
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A scout profile. v1: each account auto-creates one default scout on first
-- login; parents add more via the profile switcher.
CREATE TABLE scouts (
  id           TEXT PRIMARY KEY,                       -- uuid
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_scouts_account ON scouts(account_id);

-- Personal "closet" — gear a scout owns. Mirrors lighterpack fields.
CREATE TABLE closet_items (
  id            TEXT PRIMARY KEY,
  scout_id      TEXT NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  brand         TEXT,
  category      TEXT NOT NULL,
  weight_grams  INTEGER,
  quantity      INTEGER NOT NULL DEFAULT 1,
  is_worn       INTEGER NOT NULL DEFAULT 0,
  is_consumable INTEGER NOT NULL DEFAULT 0,
  -- Normalized lowercase key used for auto-linking template items to closet
  -- items on packing-list generation (e.g. "headlamp", "sleeping_pad").
  match_key     TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_closet_scout ON closet_items(scout_id);
CREATE INDEX idx_closet_match ON closet_items(scout_id, match_key);

-- Leader-curated packing-list template, one *active* version per event type.
-- Editing creates a new row with is_active=1 and demotes the previous.
CREATE TABLE templates (
  id         TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('summer_camp','car_camping','backpacking','day_hike')),
  name       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,                       -- email of leader
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_templates_type_active
  ON templates(event_type) WHERE is_active = 1;

CREATE TABLE template_items (
  id            TEXT PRIMARY KEY,
  template_id   TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  category      TEXT NOT NULL,
  default_qty   INTEGER NOT NULL DEFAULT 1,
  is_worn       INTEGER NOT NULL DEFAULT 0,
  is_consumable INTEGER NOT NULL DEFAULT 0,
  match_key     TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_template_items_tpl ON template_items(template_id);

-- A scout's packing list for one calendar event. Cloned from a template,
-- then customized. event_id is a foreign reference into the read-only
-- events DB (not enforced; validated at the API layer).
CREATE TABLE packing_lists (
  id          TEXT PRIMARY KEY,
  scout_id    TEXT NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
  event_id    TEXT NOT NULL,
  template_id TEXT REFERENCES templates(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(scout_id, event_id)
);
CREATE INDEX idx_packing_lists_scout ON packing_lists(scout_id);

CREATE TABLE packing_list_items (
  id              TEXT PRIMARY KEY,
  packing_list_id TEXT NOT NULL REFERENCES packing_lists(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  category        TEXT NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1,
  is_worn         INTEGER NOT NULL DEFAULT 0,
  is_consumable   INTEGER NOT NULL DEFAULT 0,
  match_key       TEXT NOT NULL,
  -- Linked owned item, if any. NULL => "missing from your closet".
  closet_item_id  TEXT REFERENCES closet_items(id) ON DELETE SET NULL,
  packed          INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_packing_list_items_list ON packing_list_items(packing_list_id);

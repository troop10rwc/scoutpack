-- Recommended gear: a leader-curated catalog of products (with pricing + where
-- to buy), explicitly linked to template items as the "suggested product", and a
-- per-scout wishlist that selecting a recommendation drops into. Fulfilling a
-- wishlist item ("Got it") creates the closet item, where the existing match_key
-- plumbing auto-links it to packing lists.

PRAGMA foreign_keys = ON;

-- Leader-curated catalog of recommended products.
CREATE TABLE recommended_gear (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  description  TEXT,
  brand        TEXT,
  weight_grams INTEGER,
  match_key    TEXT NOT NULL,                 -- derived from name (slug.ts)
  is_active    INTEGER NOT NULL DEFAULT 1,    -- soft-archive; ids stay resolvable
  sort_order   INTEGER NOT NULL DEFAULT 0,
  updated_by   TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_recgear_active ON recommended_gear(is_active, category, sort_order);

-- Multiple "where to buy" options per catalog item.
CREATE TABLE recommended_gear_options (
  id          TEXT PRIMARY KEY,
  gear_id     TEXT NOT NULL REFERENCES recommended_gear(id) ON DELETE CASCADE,
  vendor      TEXT NOT NULL,
  price_cents INTEGER,                        -- nullable; cents to avoid float
  url         TEXT,
  note        TEXT,                           -- e.g. "troop discount", "used"
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_recopt_gear ON recommended_gear_options(gear_id);

-- Explicit leader link: a template line item's suggested product.
ALTER TABLE template_items     ADD COLUMN recommended_gear_id TEXT
  REFERENCES recommended_gear(id) ON DELETE SET NULL;
-- Cloned to the packing list at generation so scouts see the suggestion.
ALTER TABLE packing_list_items ADD COLUMN recommended_gear_id TEXT
  REFERENCES recommended_gear(id) ON DELETE SET NULL;

-- Per-scout wishlist. Stores a snapshot (survives catalog archive/delete) plus a
-- live reference to the catalog item for current buy options.
CREATE TABLE wishlist_items (
  id           TEXT PRIMARY KEY,
  scout_id     TEXT NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
  gear_id      TEXT REFERENCES recommended_gear(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  description  TEXT,
  brand        TEXT,
  weight_grams INTEGER,
  match_key    TEXT NOT NULL,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_wishlist_scout ON wishlist_items(scout_id);
CREATE UNIQUE INDEX idx_wishlist_dedupe
  ON wishlist_items(scout_id, gear_id) WHERE gear_id IS NOT NULL;

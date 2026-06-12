-- Recommendation sets: a level above the single-product catalog. A "set" is one
-- gear need (e.g. "Backpacking sleeping bag") that holds 1-3 product *picks*,
-- each annotated with a "best for" label (Budget / Most durable / …) and a
-- rationale, plus its own buy links. Template lines now suggest a SET (the
-- alternatives); the scout picks one product, which is what lands on the wishlist.
-- A 1-pick set behaves exactly like the old single-product recommendation.

PRAGMA foreign_keys = ON;

CREATE TABLE recommendation_sets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,              -- the need, e.g. "Backpacking sleeping bag"
  category    TEXT NOT NULL,
  description TEXT,                        -- "how to choose" guidance
  match_key   TEXT NOT NULL,              -- slug(name); CSV upsert + template autocomplete
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  updated_by  TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_recset_active ON recommendation_sets(is_active, category, sort_order);

-- recommended_gear becomes a "pick" inside a set.
ALTER TABLE recommended_gear ADD COLUMN set_id     TEXT REFERENCES recommendation_sets(id) ON DELETE CASCADE;
ALTER TABLE recommended_gear ADD COLUMN pick_label TEXT;   -- "Budget", "Most durable", …
ALTER TABLE recommended_gear ADD COLUMN rationale  TEXT;   -- one-line why
CREATE INDEX idx_recgear_set ON recommended_gear(set_id);

-- Template/packing now suggest a SET (the alternatives), not one product.
ALTER TABLE template_items     ADD COLUMN recommendation_set_id TEXT REFERENCES recommendation_sets(id) ON DELETE SET NULL;
ALTER TABLE packing_list_items ADD COLUMN recommendation_set_id TEXT REFERENCES recommendation_sets(id) ON DELETE SET NULL;

-- Migrate existing single-product recs into singleton sets. The deterministic
-- 'set-<gearId>' id lets the existing template/packing links be repointed here.
INSERT INTO recommendation_sets (id, name, category, match_key, is_active, sort_order, updated_by)
  SELECT 'set-' || id, name, category, match_key, is_active, sort_order, updated_by FROM recommended_gear;
UPDATE recommended_gear SET set_id = 'set-' || id;
UPDATE template_items     SET recommendation_set_id = 'set-' || recommended_gear_id WHERE recommended_gear_id IS NOT NULL;
UPDATE packing_list_items SET recommendation_set_id = 'set-' || recommended_gear_id WHERE recommended_gear_id IS NOT NULL;

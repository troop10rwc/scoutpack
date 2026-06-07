-- Per-item metadata borrowed from the LighterPack item UI: an optional photo
-- (stored in R2, referenced by object key), an optional link, a favorite flag,
-- and an explicit sort order so items can be drag-reordered within and across
-- categories.
ALTER TABLE closet_items ADD COLUMN link_url    TEXT;
ALTER TABLE closet_items ADD COLUMN image_key   TEXT;
ALTER TABLE closet_items ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE closet_items ADD COLUMN sort_order  INTEGER NOT NULL DEFAULT 0;

-- Backfill sort_order: position each item within its category by current name
-- order, so existing closets keep a stable, sensible ordering.
UPDATE closet_items
   SET sort_order = (
     SELECT COUNT(*)
       FROM closet_items b
      WHERE b.scout_id = closet_items.scout_id
        AND b.category = closet_items.category
        AND (b.name < closet_items.name
             OR (b.name = closet_items.name AND b.id < closet_items.id))
   );

CREATE INDEX idx_closet_sort ON closet_items(scout_id, category, sort_order);

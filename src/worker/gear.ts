import type {
  ClosetItem,
  ImportPreviewItem,
  PackingList,
  PackingListBundle,
  PackingListItem,
  Template,
  TemplateBundle,
  TemplateItem,
  TroopEvent,
  UpcomingEvent,
} from "../shared/types.ts";
import { matchKey } from "../shared/slug.ts";
import { ImportError, lighterpackCsvUrl, parseLighterpackCsv } from "./lighterpack.ts";
import { getRecommendationSetBundle, loadRecommendationSetsByIds } from "./recommend.ts";
import type { EventType } from "../shared/constants.ts";

// ---------- closet ----------

export async function listCloset(db: D1Database, scoutId: string): Promise<ClosetItem[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM closet_items WHERE scout_id = ? ORDER BY category, sort_order, name`,
    )
    .bind(scoutId)
    .all<ClosetItem>();
  return results ?? [];
}

export interface ClosetItemInput {
  name: string;
  description?: string | null;
  brand?: string | null;
  category: string;
  weight_grams?: number | null;
  quantity?: number;
  is_worn?: boolean;
  is_consumable?: boolean;
  is_favorite?: boolean;
  link_url?: string | null;
  sort_order?: number;
}

// Next free sort_order at the end of a category for this scout.
async function nextSortOrder(
  db: D1Database,
  scoutId: string,
  category: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n
         FROM closet_items WHERE scout_id = ? AND category = ?`,
    )
    .bind(scoutId, category)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function createClosetItem(
  db: D1Database,
  scoutId: string,
  input: ClosetItemInput,
): Promise<ClosetItem> {
  const id = crypto.randomUUID();
  const key = matchKey(input.name);
  const sortOrder = input.sort_order ?? (await nextSortOrder(db, scoutId, input.category));
  await db
    .prepare(
      `INSERT INTO closet_items (id, scout_id, name, description, brand, category,
                                 weight_grams, quantity, is_worn, is_consumable,
                                 is_favorite, link_url, sort_order, match_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      scoutId,
      input.name,
      input.description ?? null,
      input.brand ?? null,
      input.category,
      input.weight_grams ?? null,
      input.quantity ?? 1,
      input.is_worn ? 1 : 0,
      input.is_consumable ? 1 : 0,
      input.is_favorite ? 1 : 0,
      input.link_url ?? null,
      sortOrder,
      key,
    )
    .run();
  // Auto-link any pending packing-list items that match this newly-added gear.
  await db
    .prepare(
      `UPDATE packing_list_items
          SET closet_item_id = ?
        WHERE closet_item_id IS NULL
          AND match_key = ?
          AND packing_list_id IN (SELECT id FROM packing_lists WHERE scout_id = ?)`,
    )
    .bind(id, key, scoutId)
    .run();
  const row = await db.prepare(`SELECT * FROM closet_items WHERE id = ?`).bind(id).first<ClosetItem>();
  if (!row) throw new Error("failed to create closet item");
  return row;
}

export async function updateClosetItem(
  db: D1Database,
  scoutId: string,
  itemId: string,
  input: Partial<ClosetItemInput>,
): Promise<ClosetItem | null> {
  const row = await db
    .prepare(`SELECT * FROM closet_items WHERE id = ? AND scout_id = ?`)
    .bind(itemId, scoutId)
    .first<ClosetItem>();
  if (!row) return null;
  const merged: ClosetItem = {
    ...row,
    name: input.name ?? row.name,
    description: input.description !== undefined ? input.description : row.description,
    brand: input.brand !== undefined ? input.brand : row.brand,
    category: input.category ?? row.category,
    weight_grams: input.weight_grams !== undefined ? input.weight_grams : row.weight_grams,
    quantity: input.quantity ?? row.quantity,
    is_worn: input.is_worn !== undefined ? (input.is_worn ? 1 : 0) : row.is_worn,
    is_consumable:
      input.is_consumable !== undefined ? (input.is_consumable ? 1 : 0) : row.is_consumable,
    is_favorite: input.is_favorite !== undefined ? (input.is_favorite ? 1 : 0) : row.is_favorite,
    link_url: input.link_url !== undefined ? input.link_url : row.link_url,
  };
  // Moving an item to a different category (via inline edit) appends it to the
  // end of the target category; drag-reorder sets sort_order explicitly instead.
  let sortOrder = input.sort_order ?? row.sort_order;
  if (input.category && input.category !== row.category && input.sort_order === undefined) {
    sortOrder = await nextSortOrder(db, scoutId, input.category);
  }
  const newKey = matchKey(merged.name);
  await db
    .prepare(
      `UPDATE closet_items
          SET name=?, description=?, brand=?, category=?, weight_grams=?, quantity=?,
              is_worn=?, is_consumable=?, is_favorite=?, link_url=?, sort_order=?,
              match_key=?, updated_at=datetime('now')
        WHERE id=?`,
    )
    .bind(
      merged.name, merged.description, merged.brand, merged.category, merged.weight_grams,
      merged.quantity, merged.is_worn, merged.is_consumable, merged.is_favorite,
      merged.link_url, sortOrder, newKey, itemId,
    )
    .run();
  return { ...merged, sort_order: sortOrder, match_key: newKey };
}

// Batch-apply a new ordering (and category membership) produced by a drag. Each
// entry carries the item's new category + sort_order. Verifies ownership first.
export async function reorderCloset(
  db: D1Database,
  scoutId: string,
  order: { id: string; category: string; sort_order: number }[],
): Promise<boolean> {
  if (!order.length) return true;
  const ids = order.map((o) => o.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT id FROM closet_items WHERE scout_id = ? AND id IN (${placeholders})`)
    .bind(scoutId, ...ids)
    .all<{ id: string }>();
  const owned = new Set((results ?? []).map((r) => r.id));
  const valid = order.filter((o) => owned.has(o.id));
  if (!valid.length) return false;
  await db.batch(
    valid.map((o) =>
      db
        .prepare(
          `UPDATE closet_items SET category=?, sort_order=?, updated_at=datetime('now')
            WHERE id=? AND scout_id=?`,
        )
        .bind(o.category, o.sort_order, o.id, scoutId),
    ),
  );
  return true;
}

export async function getClosetItem(
  db: D1Database,
  scoutId: string,
  itemId: string,
): Promise<ClosetItem | null> {
  return await db
    .prepare(`SELECT * FROM closet_items WHERE id = ? AND scout_id = ?`)
    .bind(itemId, scoutId)
    .first<ClosetItem>();
}

// Point an item at a new R2 photo (or clear it with null). Returns the item.
export async function setClosetImageKey(
  db: D1Database,
  scoutId: string,
  itemId: string,
  key: string | null,
): Promise<ClosetItem | null> {
  const row = await getClosetItem(db, scoutId, itemId);
  if (!row) return null;
  await db
    .prepare(
      `UPDATE closet_items SET image_key=?, updated_at=datetime('now')
        WHERE id=? AND scout_id=?`,
    )
    .bind(key, itemId, scoutId)
    .run();
  return { ...row, image_key: key };
}

export async function deleteClosetItem(db: D1Database, scoutId: string, itemId: string): Promise<boolean> {
  const res = await db
    .prepare(`DELETE FROM closet_items WHERE id = ? AND scout_id = ?`)
    .bind(itemId, scoutId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

// ---------- closet import (LighterPack CSV) ----------

// Fetch and parse a LighterPack CSV, flagging rows that already exist in the
// scout's closet (or repeat earlier in the CSV) so the UI can default them off.
export async function previewClosetImport(
  db: D1Database,
  scoutId: string,
  url: string,
): Promise<ImportPreviewItem[]> {
  const csvUrl = lighterpackCsvUrl(url);
  let res: Response;
  try {
    res = await fetch(csvUrl, { headers: { accept: "text/csv,*/*" } });
  } catch {
    throw new ImportError("Could not reach LighterPack");
  }
  if (!res.ok) throw new ImportError(`Could not fetch CSV (HTTP ${res.status})`);
  const parsed = parseLighterpackCsv(await res.text());
  if (!parsed.length) throw new ImportError("No items found in that CSV");

  const existing = await listCloset(db, scoutId);
  const existingKeys = new Set(existing.map((i) => i.match_key));
  const seen = new Set<string>();
  return parsed.map((it) => {
    const key = matchKey(it.name);
    const duplicate = existingKeys.has(key) || seen.has(key);
    seen.add(key);
    return { ...it, match_key: key, duplicate };
  });
}

// Bulk-insert the user-selected import rows, then relink any unlinked
// packing-list items that now match a closet item (same logic as the single
// createClosetItem path, applied once for the whole batch).
export async function importClosetItems(
  db: D1Database,
  scoutId: string,
  inputs: ClosetItemInput[],
): Promise<ClosetItem[]> {
  if (!inputs.length) return [];
  // Append each imported item to the end of its category. Seed per-category
  // counters from existing maxes so imports don't collide with current items.
  const { results: maxes } = await db
    .prepare(
      `SELECT category, MAX(sort_order) AS m FROM closet_items
        WHERE scout_id = ? GROUP BY category`,
    )
    .bind(scoutId)
    .all<{ category: string; m: number }>();
  const nextByCat = new Map<string, number>(
    (maxes ?? []).map((r) => [r.category, (r.m ?? -1) + 1]),
  );
  const ids: string[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (const input of inputs) {
    const id = crypto.randomUUID();
    ids.push(id);
    const sortOrder = nextByCat.get(input.category) ?? 0;
    nextByCat.set(input.category, sortOrder + 1);
    stmts.push(
      db
        .prepare(
          `INSERT INTO closet_items (id, scout_id, name, description, brand, category,
                                     weight_grams, quantity, is_worn, is_consumable,
                                     is_favorite, link_url, sort_order, match_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          scoutId,
          input.name,
          input.description ?? null,
          input.brand ?? null,
          input.category,
          input.weight_grams ?? null,
          input.quantity ?? 1,
          input.is_worn ? 1 : 0,
          input.is_consumable ? 1 : 0,
          input.is_favorite ? 1 : 0,
          input.link_url ?? null,
          sortOrder,
          matchKey(input.name),
        ),
    );
  }
  // Relink pending packing-list items to whichever new closet item matches.
  stmts.push(
    db
      .prepare(
        `UPDATE packing_list_items
            SET closet_item_id = (
              SELECT ci.id FROM closet_items ci
               WHERE ci.scout_id = ?1 AND ci.match_key = packing_list_items.match_key
               LIMIT 1)
          WHERE closet_item_id IS NULL
            AND packing_list_id IN (SELECT id FROM packing_lists WHERE scout_id = ?1)
            AND match_key IN (SELECT match_key FROM closet_items WHERE scout_id = ?1)`,
      )
      .bind(scoutId),
  );
  await db.batch(stmts);

  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT * FROM closet_items WHERE id IN (${placeholders}) ORDER BY category, name`)
    .bind(...ids)
    .all<ClosetItem>();
  return results ?? [];
}

// ---------- templates ----------

export async function listActiveTemplates(db: D1Database): Promise<Template[]> {
  const { results } = await db
    .prepare(`SELECT * FROM templates WHERE is_active = 1 ORDER BY event_type`)
    .all<Template>();
  return results ?? [];
}

export async function getActiveTemplate(
  db: D1Database,
  eventType: EventType,
): Promise<TemplateBundle | null> {
  const tpl = await db
    .prepare(`SELECT * FROM templates WHERE event_type = ? AND is_active = 1`)
    .bind(eventType)
    .first<Template>();
  if (!tpl) return null;
  const { results } = await db
    .prepare(`SELECT * FROM template_items WHERE template_id = ? ORDER BY sort_order, name`)
    .bind(tpl.id)
    .all<TemplateItem>();
  return { template: tpl, items: results ?? [] };
}

export interface TemplateInput {
  name: string;
  items: Array<{
    name: string;
    description?: string | null;
    category: string;
    default_qty?: number;
    is_worn?: boolean;
    is_consumable?: boolean;
    recommendation_set_id?: string | null;
    sort_order?: number;
  }>;
}

// Publish a new active template version for `eventType`. Demotes the previous
// active row. Existing per-scout packing lists are unaffected — they keep
// their cloned snapshot until the scout regenerates.
export async function publishTemplate(
  db: D1Database,
  eventType: EventType,
  updatedBy: string,
  input: TemplateInput,
): Promise<TemplateBundle> {
  const id = crypto.randomUUID();
  const stmts: D1PreparedStatement[] = [
    db.prepare(`UPDATE templates SET is_active = 0 WHERE event_type = ? AND is_active = 1`)
      .bind(eventType),
    db.prepare(
      `INSERT INTO templates (id, event_type, name, is_active, updated_by)
       VALUES (?, ?, ?, 1, ?)`,
    ).bind(id, eventType, input.name, updatedBy),
  ];
  for (const [idx, it] of input.items.entries()) {
    stmts.push(
      db.prepare(
        `INSERT INTO template_items
           (id, template_id, name, description, category, default_qty,
            is_worn, is_consumable, match_key, recommendation_set_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        id,
        it.name,
        it.description ?? null,
        it.category,
        it.default_qty ?? 1,
        it.is_worn ? 1 : 0,
        it.is_consumable ? 1 : 0,
        matchKey(it.name),
        it.recommendation_set_id ?? null,
        it.sort_order ?? idx * 10,
      ),
    );
  }
  await db.batch(stmts);
  const bundle = await getActiveTemplate(db, eventType);
  if (!bundle) throw new Error("failed to publish template");
  return bundle;
}

// ---------- packing lists ----------

export async function findPackingList(
  db: D1Database,
  scoutId: string,
  eventId: string,
): Promise<PackingList | null> {
  return await db
    .prepare(`SELECT * FROM packing_lists WHERE scout_id = ? AND event_id = ?`)
    .bind(scoutId, eventId)
    .first<PackingList>();
}

// Clone the active template for the event's type and auto-link to the scout's
// closet via match_key. Returns the existing list if one already exists.
export async function createPackingList(
  db: D1Database,
  scoutId: string,
  event: TroopEvent,
): Promise<PackingList> {
  const existing = await findPackingList(db, scoutId, event.id);
  if (existing) return existing;
  const bundle = await getActiveTemplate(db, event.event_type);
  if (!bundle) throw new Error(`no active template for ${event.event_type}`);

  const listId = crypto.randomUUID();
  const closet = await listCloset(db, scoutId);
  const ownedByKey = new Map<string, string>();
  for (const it of closet) ownedByKey.set(it.match_key, it.id);

  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO packing_lists (id, scout_id, event_id, template_id) VALUES (?, ?, ?, ?)`,
    ).bind(listId, scoutId, event.id, bundle.template.id),
  ];
  for (const ti of bundle.items) {
    stmts.push(
      db.prepare(
        `INSERT INTO packing_list_items
           (id, packing_list_id, name, description, category, quantity,
            is_worn, is_consumable, match_key, closet_item_id, recommendation_set_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        listId,
        ti.name,
        ti.description,
        ti.category,
        ti.default_qty,
        ti.is_worn,
        ti.is_consumable,
        ti.match_key,
        ownedByKey.get(ti.match_key) ?? null,
        ti.recommendation_set_id ?? null,
        ti.sort_order,
      ),
    );
  }
  await db.batch(stmts);

  const row = await db
    .prepare(`SELECT * FROM packing_lists WHERE id = ?`)
    .bind(listId)
    .first<PackingList>();
  if (!row) throw new Error("failed to create packing list");
  return row;
}

export async function loadPackingListBundle(
  db: D1Database,
  scoutId: string,
  event: TroopEvent,
): Promise<PackingListBundle | null> {
  const list = await findPackingList(db, scoutId, event.id);
  if (!list) return null;
  const { results: itemRows } = await db
    .prepare(
      `SELECT * FROM packing_list_items WHERE packing_list_id = ? ORDER BY sort_order, name`,
    )
    .bind(list.id)
    .all<PackingListItem>();
  const items = itemRows ?? [];

  const closetIds = items.map((i) => i.closet_item_id).filter((x): x is string => !!x);
  let closetMap = new Map<string, ClosetItem>();
  if (closetIds.length) {
    const placeholders = closetIds.map(() => "?").join(",");
    const { results: closetRows } = await db
      .prepare(`SELECT * FROM closet_items WHERE id IN (${placeholders})`)
      .bind(...closetIds)
      .all<ClosetItem>();
    closetMap = new Map((closetRows ?? []).map((c) => [c.id, c]));
  }

  // Suggested sets linked on these rows (one batched lookup, no N+1).
  const recMap = await loadRecommendationSetsByIds(
    db,
    items.map((i) => i.recommendation_set_id).filter((x): x is string => !!x),
  );

  return {
    list,
    event,
    items: items.map((it) => ({
      ...it,
      owned: it.closet_item_id !== null,
      closet_item: it.closet_item_id ? closetMap.get(it.closet_item_id) ?? null : null,
      recommendation: it.recommendation_set_id ? recMap.get(it.recommendation_set_id) ?? null : null,
    })),
  };
}

// The bundle-shaped item the UI consumes: the raw row plus its resolved
// ownership (linked closet item, if any).
export type EnrichedPackingItem = PackingListBundle["items"][number];

// Load one packing-list item in bundle shape (with owned + closet_item),
// verifying it belongs to the scout. Returned by add/update so the client can
// reflect re-linking and ownership without a full reload.
export async function loadPackingItem(
  db: D1Database,
  scoutId: string,
  itemId: string,
): Promise<EnrichedPackingItem | null> {
  const it = await db
    .prepare(
      `SELECT pli.* FROM packing_list_items pli
        JOIN packing_lists pl ON pl.id = pli.packing_list_id
       WHERE pli.id = ? AND pl.scout_id = ?`,
    )
    .bind(itemId, scoutId)
    .first<PackingListItem>();
  if (!it) return null;
  let closet: ClosetItem | null = null;
  if (it.closet_item_id) {
    closet = await db
      .prepare(`SELECT * FROM closet_items WHERE id = ?`)
      .bind(it.closet_item_id)
      .first<ClosetItem>();
  }
  const recommendation = it.recommendation_set_id
    ? await getRecommendationSetBundle(db, it.recommendation_set_id)
    : null;
  return { ...it, owned: it.closet_item_id !== null, closet_item: closet, recommendation };
}

// The closet item (if any) owned by this scout that matches a gear name. Used
// to (re)link a packing item to the closet when it's created or renamed.
async function closetIdForName(
  db: D1Database,
  scoutId: string,
  key: string,
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT id FROM closet_items WHERE scout_id = ? AND match_key = ? LIMIT 1`)
    .bind(scoutId, key)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export interface NewPackingItem {
  name: string;
  category: string;
  description?: string | null;
  quantity?: number;
  is_worn?: boolean;
  is_consumable?: boolean;
}

// Add a single item to an existing packing list (verifying list ownership),
// auto-linking to the closet by match_key. Appends to the end of its category.
export async function addPackingListItem(
  db: D1Database,
  scoutId: string,
  listId: string,
  input: NewPackingItem,
): Promise<EnrichedPackingItem | null> {
  const list = await db
    .prepare(`SELECT id FROM packing_lists WHERE id = ? AND scout_id = ?`)
    .bind(listId, scoutId)
    .first<{ id: string }>();
  if (!list) return null;
  const id = crypto.randomUUID();
  const key = matchKey(input.name);
  const so = await db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n
         FROM packing_list_items WHERE packing_list_id = ? AND category = ?`,
    )
    .bind(listId, input.category)
    .first<{ n: number }>();
  const closetId = await closetIdForName(db, scoutId, key);
  await db
    .prepare(
      `INSERT INTO packing_list_items
         (id, packing_list_id, name, description, category, quantity,
          is_worn, is_consumable, match_key, closet_item_id, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      listId,
      input.name,
      input.description ?? null,
      input.category,
      input.quantity ?? 1,
      input.is_worn ? 1 : 0,
      input.is_consumable ? 1 : 0,
      key,
      closetId,
      so?.n ?? 0,
    )
    .run();
  return loadPackingItem(db, scoutId, id);
}

export async function deletePackingListItem(
  db: D1Database,
  scoutId: string,
  itemId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT pli.id FROM packing_list_items pli
        JOIN packing_lists pl ON pl.id = pli.packing_list_id
       WHERE pli.id = ? AND pl.scout_id = ?`,
    )
    .bind(itemId, scoutId)
    .first<{ id: string }>();
  if (!row) return false;
  await db.prepare(`DELETE FROM packing_list_items WHERE id = ?`).bind(itemId).run();
  return true;
}

// Delete a scout's whole packing list for an event — the event "binding" itself.
// Items go with it (explicit delete + ON DELETE CASCADE both cover them). Returns
// false if the scout has no list bound to that event. Rarely used: it lets a
// scout discard a list and regenerate a fresh one from the current template.
export async function deletePackingList(
  db: D1Database,
  scoutId: string,
  eventId: string,
): Promise<boolean> {
  const list = await findPackingList(db, scoutId, eventId);
  if (!list) return false;
  await db.batch([
    db.prepare(`DELETE FROM packing_list_items WHERE packing_list_id = ?`).bind(list.id),
    db.prepare(`DELETE FROM packing_lists WHERE id = ?`).bind(list.id),
  ]);
  return true;
}

export interface PackingItemPatch {
  packed?: boolean;
  quantity?: number;
  closet_item_id?: string | null; // explicit link/unlink
  name?: string;
  category?: string;
  description?: string | null;
  is_worn?: boolean;
  is_consumable?: boolean;
}

export async function updatePackingListItem(
  db: D1Database,
  scoutId: string,
  itemId: string,
  patch: PackingItemPatch,
): Promise<EnrichedPackingItem | null> {
  // Ownership check via join.
  const row = await db
    .prepare(
      `SELECT pli.id FROM packing_list_items pli
        JOIN packing_lists pl ON pl.id = pli.packing_list_id
       WHERE pli.id = ? AND pl.scout_id = ?`,
    )
    .bind(itemId, scoutId)
    .first<{ id: string }>();
  if (!row) return null;
  const fields: string[] = [];
  const binds: (string | number | null)[] = [];
  if (patch.packed !== undefined) {
    fields.push("packed = ?");
    binds.push(patch.packed ? 1 : 0);
  }
  if (patch.quantity !== undefined) {
    fields.push("quantity = ?");
    binds.push(patch.quantity);
  }
  if (patch.category !== undefined) {
    fields.push("category = ?");
    binds.push(patch.category);
  }
  if (patch.description !== undefined) {
    fields.push("description = ?");
    binds.push(patch.description);
  }
  if (patch.is_worn !== undefined) {
    fields.push("is_worn = ?");
    binds.push(patch.is_worn ? 1 : 0);
  }
  if (patch.is_consumable !== undefined) {
    fields.push("is_consumable = ?");
    binds.push(patch.is_consumable ? 1 : 0);
  }
  if (patch.name !== undefined) {
    const key = matchKey(patch.name);
    fields.push("name = ?", "match_key = ?");
    binds.push(patch.name, key);
    // Renaming re-links the item to whatever closet gear now matches, unless the
    // caller is also setting closet_item_id explicitly (handled below).
    if (patch.closet_item_id === undefined) {
      fields.push("closet_item_id = ?");
      binds.push(await closetIdForName(db, scoutId, key));
    }
  }
  if (patch.closet_item_id !== undefined) {
    fields.push("closet_item_id = ?");
    binds.push(patch.closet_item_id);
  }
  if (fields.length) {
    binds.push(itemId);
    await db
      .prepare(`UPDATE packing_list_items SET ${fields.join(", ")} WHERE id = ?`)
      .bind(...binds)
      .run();
  }
  return loadPackingItem(db, scoutId, itemId);
}

// Apply a drag ordering (and category membership) to packing-list items. Each
// entry carries the item's new category + sort_order. Ownership is verified by
// joining back to the scout's packing lists; only owned ids are written.
export async function reorderPackingItems(
  db: D1Database,
  scoutId: string,
  order: { id: string; category: string; sort_order: number }[],
): Promise<boolean> {
  if (!order.length) return true;
  const ids = order.map((o) => o.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT pli.id FROM packing_list_items pli
        JOIN packing_lists pl ON pl.id = pli.packing_list_id
       WHERE pl.scout_id = ? AND pli.id IN (${placeholders})`,
    )
    .bind(scoutId, ...ids)
    .all<{ id: string }>();
  const owned = new Set((results ?? []).map((r) => r.id));
  const valid = order.filter((o) => owned.has(o.id));
  if (!valid.length) return false;
  await db.batch(
    valid.map((o) =>
      db
        .prepare(`UPDATE packing_list_items SET category=?, sort_order=? WHERE id=?`)
        .bind(o.category, o.sort_order, o.id),
    ),
  );
  return true;
}

// Per-scout packing stats for a set of events. Used by the dashboard.
export async function attachPackingStats(
  db: D1Database,
  scoutId: string,
  events: TroopEvent[],
): Promise<UpcomingEvent[]> {
  if (!events.length) return [];
  const ids = events.map((e) => e.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT pl.event_id, pl.id AS list_id,
              COUNT(pli.id) AS total,
              SUM(CASE WHEN pli.closet_item_id IS NOT NULL THEN 1 ELSE 0 END) AS owned,
              SUM(pli.packed) AS packed
         FROM packing_lists pl
         LEFT JOIN packing_list_items pli ON pli.packing_list_id = pl.id
        WHERE pl.scout_id = ? AND pl.event_id IN (${placeholders})
        GROUP BY pl.id, pl.event_id`,
    )
    .bind(scoutId, ...ids)
    .all<{ event_id: string; list_id: string; total: number; owned: number; packed: number }>();
  const byEvent = new Map((results ?? []).map((r) => [r.event_id, r]));
  return events.map((e) => {
    const r = byEvent.get(e.id);
    return {
      ...e,
      packing: r
        ? { list_id: r.list_id, total: r.total ?? 0, owned: r.owned ?? 0, packed: r.packed ?? 0 }
        : null,
    };
  });
}

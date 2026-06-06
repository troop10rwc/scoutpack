import type {
  ClosetItem,
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
import type { EventType } from "../shared/constants.ts";

// ---------- closet ----------

export async function listCloset(db: D1Database, scoutId: string): Promise<ClosetItem[]> {
  const { results } = await db
    .prepare(`SELECT * FROM closet_items WHERE scout_id = ? ORDER BY category, name`)
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
}

export async function createClosetItem(
  db: D1Database,
  scoutId: string,
  input: ClosetItemInput,
): Promise<ClosetItem> {
  const id = crypto.randomUUID();
  const key = matchKey(input.name);
  await db
    .prepare(
      `INSERT INTO closet_items (id, scout_id, name, description, brand, category,
                                 weight_grams, quantity, is_worn, is_consumable, match_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  };
  const newKey = matchKey(merged.name);
  await db
    .prepare(
      `UPDATE closet_items
          SET name=?, description=?, brand=?, category=?, weight_grams=?, quantity=?,
              is_worn=?, is_consumable=?, match_key=?, updated_at=datetime('now')
        WHERE id=?`,
    )
    .bind(
      merged.name, merged.description, merged.brand, merged.category, merged.weight_grams,
      merged.quantity, merged.is_worn, merged.is_consumable, newKey, itemId,
    )
    .run();
  return { ...merged, match_key: newKey };
}

export async function deleteClosetItem(db: D1Database, scoutId: string, itemId: string): Promise<boolean> {
  const res = await db
    .prepare(`DELETE FROM closet_items WHERE id = ? AND scout_id = ?`)
    .bind(itemId, scoutId)
    .run();
  return (res.meta.changes ?? 0) > 0;
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
            is_worn, is_consumable, match_key, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            is_worn, is_consumable, match_key, closet_item_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  return {
    list,
    event,
    items: items.map((it) => ({
      ...it,
      owned: it.closet_item_id !== null,
      closet_item: it.closet_item_id ? closetMap.get(it.closet_item_id) ?? null : null,
    })),
  };
}

export interface PackingItemPatch {
  packed?: boolean;
  quantity?: number;
  closet_item_id?: string | null; // explicit link/unlink
}

export async function updatePackingListItem(
  db: D1Database,
  scoutId: string,
  itemId: string,
  patch: PackingItemPatch,
): Promise<boolean> {
  // Ownership check via join.
  const row = await db
    .prepare(
      `SELECT pli.id FROM packing_list_items pli
        JOIN packing_lists pl ON pl.id = pli.packing_list_id
       WHERE pli.id = ? AND pl.scout_id = ?`,
    )
    .bind(itemId, scoutId)
    .first<{ id: string }>();
  if (!row) return false;
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
  if (patch.closet_item_id !== undefined) {
    fields.push("closet_item_id = ?");
    binds.push(patch.closet_item_id);
  }
  if (!fields.length) return true;
  binds.push(itemId);
  await db
    .prepare(`UPDATE packing_list_items SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
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

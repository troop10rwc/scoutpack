import type {
  ClosetItem,
  RecommendedGear,
  RecommendedGearBundle,
  RecommendedGearOption,
  WishlistItem,
} from "../shared/types.ts";
import { matchKey } from "../shared/slug.ts";
import { createClosetItem } from "./gear.ts";

// ---------- recommended gear catalog ----------

export interface RecommendedOptionInput {
  vendor: string;
  price_cents?: number | null;
  url?: string | null;
  note?: string | null;
}

export interface RecommendedGearInput {
  name: string;
  category: string;
  description?: string | null;
  brand?: string | null;
  weight_grams?: number | null;
  sort_order?: number;
  options: RecommendedOptionInput[];
}

// Group a flat option list under its gear id.
function groupOptions(rows: RecommendedGearOption[]): Map<string, RecommendedGearOption[]> {
  const byGear = new Map<string, RecommendedGearOption[]>();
  for (const o of rows) {
    const arr = byGear.get(o.gear_id) ?? [];
    arr.push(o);
    byGear.set(o.gear_id, arr);
  }
  return byGear;
}

// The whole catalog as bundles (gear + its buy options). Active rows only unless
// `includeArchived` (the leader editor wants to see/restore archived rows). One
// query for gear, one for options, joined in code — D1 has no cross-table
// hydration and this mirrors the closet/packing pattern.
export async function listRecommendedGear(
  db: D1Database,
  includeArchived = false,
): Promise<RecommendedGearBundle[]> {
  const { results: gear } = await db
    .prepare(
      `SELECT * FROM recommended_gear
        ${includeArchived ? "" : "WHERE is_active = 1"}
        ORDER BY category, sort_order, name`,
    )
    .all<RecommendedGear>();
  const list = gear ?? [];
  if (!list.length) return [];
  const { results: opts } = await db
    .prepare(`SELECT * FROM recommended_gear_options ORDER BY sort_order, vendor`)
    .all<RecommendedGearOption>();
  const byGear = groupOptions(opts ?? []);
  return list.map((g) => ({ gear: g, options: byGear.get(g.id) ?? [] }));
}

export async function getRecommendedBundle(
  db: D1Database,
  id: string,
): Promise<RecommendedGearBundle | null> {
  const gear = await db
    .prepare(`SELECT * FROM recommended_gear WHERE id = ?`)
    .bind(id)
    .first<RecommendedGear>();
  if (!gear) return null;
  const { results } = await db
    .prepare(`SELECT * FROM recommended_gear_options WHERE gear_id = ? ORDER BY sort_order, vendor`)
    .bind(id)
    .all<RecommendedGearOption>();
  return { gear, options: results ?? [] };
}

// Load several catalog bundles by id (used to attach suggestions to a packing
// list without an N+1). Returns a map keyed by gear id.
export async function loadRecommendationsByIds(
  db: D1Database,
  ids: string[],
): Promise<Map<string, RecommendedGearBundle>> {
  const map = new Map<string, RecommendedGearBundle>();
  const unique = [...new Set(ids)];
  if (!unique.length) return map;
  const placeholders = unique.map(() => "?").join(",");
  const { results: gear } = await db
    .prepare(`SELECT * FROM recommended_gear WHERE id IN (${placeholders})`)
    .bind(...unique)
    .all<RecommendedGear>();
  const list = gear ?? [];
  if (!list.length) return map;
  const { results: opts } = await db
    .prepare(
      `SELECT * FROM recommended_gear_options WHERE gear_id IN (${placeholders})
        ORDER BY sort_order, vendor`,
    )
    .bind(...unique)
    .all<RecommendedGearOption>();
  const byGear = groupOptions(opts ?? []);
  for (const g of list) map.set(g.id, { gear: g, options: byGear.get(g.id) ?? [] });
  return map;
}

// Statements that (re)write a catalog item's buy options: clear then re-insert,
// same delete-then-insert shape `publishTemplate` uses for template items.
function optionStmts(
  db: D1Database,
  gearId: string,
  options: RecommendedOptionInput[],
): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM recommended_gear_options WHERE gear_id = ?`).bind(gearId),
  ];
  options
    .filter((o) => o.vendor?.trim())
    .forEach((o, idx) => {
      stmts.push(
        db
          .prepare(
            `INSERT INTO recommended_gear_options
               (id, gear_id, vendor, price_cents, url, note, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            gearId,
            o.vendor.trim(),
            o.price_cents ?? null,
            o.url?.trim() || null,
            o.note?.trim() || null,
            idx * 10,
          ),
      );
    });
  return stmts;
}

export async function createRecommendedGear(
  db: D1Database,
  input: RecommendedGearInput,
  updatedBy: string,
): Promise<RecommendedGearBundle> {
  const id = crypto.randomUUID();
  const row = await db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM recommended_gear WHERE category = ?`)
    .bind(input.category)
    .first<{ n: number }>();
  const sortOrder = input.sort_order ?? row?.n ?? 0;
  await db.batch([
    db
      .prepare(
        `INSERT INTO recommended_gear
           (id, name, category, description, brand, weight_grams, match_key, sort_order, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.name,
        input.category,
        input.description ?? null,
        input.brand ?? null,
        input.weight_grams ?? null,
        matchKey(input.name),
        sortOrder,
        updatedBy,
      ),
    ...optionStmts(db, id, input.options),
  ]);
  const bundle = await getRecommendedBundle(db, id);
  if (!bundle) throw new Error("failed to create recommended gear");
  return bundle;
}

export async function updateRecommendedGear(
  db: D1Database,
  id: string,
  input: RecommendedGearInput,
  updatedBy: string,
): Promise<RecommendedGearBundle | null> {
  const existing = await db
    .prepare(`SELECT id FROM recommended_gear WHERE id = ?`)
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return null;
  await db.batch([
    db
      .prepare(
        `UPDATE recommended_gear
            SET name=?, category=?, description=?, brand=?, weight_grams=?, match_key=?,
                updated_by=?, updated_at=datetime('now')
          WHERE id=?`,
      )
      .bind(
        input.name,
        input.category,
        input.description ?? null,
        input.brand ?? null,
        input.weight_grams ?? null,
        matchKey(input.name),
        updatedBy,
        id,
      ),
    ...optionStmts(db, id, input.options),
  ]);
  return getRecommendedBundle(db, id);
}

export async function archiveRecommendedGear(db: D1Database, id: string): Promise<boolean> {
  const res = await db
    .prepare(`UPDATE recommended_gear SET is_active = 0, updated_at = datetime('now') WHERE id = ?`)
    .bind(id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

// ---------- wishlist ----------

export interface WishlistInput {
  gear_id?: string | null;
  // Raw fields used when adding something not in the catalog (gear_id absent).
  name?: string;
  category?: string;
  description?: string | null;
  brand?: string | null;
  weight_grams?: number | null;
  note?: string | null;
}

export async function listWishlist(db: D1Database, scoutId: string): Promise<WishlistItem[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM wishlist_items WHERE scout_id = ? ORDER BY category, created_at`,
    )
    .bind(scoutId)
    .all<Omit<WishlistItem, "options">>();
  const rows = results ?? [];
  if (!rows.length) return [];
  const gearIds = rows.map((r) => r.gear_id).filter((x): x is string => !!x);
  const recs = await loadRecommendationsByIds(db, gearIds);
  return rows.map((r) => ({
    ...r,
    options: r.gear_id ? recs.get(r.gear_id)?.options ?? [] : [],
  }));
}

// Add a recommendation (or a free-form item) to a scout's wishlist. When
// `gear_id` is given the snapshot is copied from the catalog server-side; a
// repeat add of the same catalog item is a no-op (dedupe index) returning the
// existing row.
export async function addToWishlist(
  db: D1Database,
  scoutId: string,
  input: WishlistInput,
): Promise<WishlistItem | null> {
  let snapshot: {
    name: string;
    category: string;
    description: string | null;
    brand: string | null;
    weight_grams: number | null;
    match_key: string;
  };
  if (input.gear_id) {
    const existing = await db
      .prepare(`SELECT id FROM wishlist_items WHERE scout_id = ? AND gear_id = ?`)
      .bind(scoutId, input.gear_id)
      .first<{ id: string }>();
    if (existing) return getWishlistItem(db, scoutId, existing.id);
    const gear = await db
      .prepare(`SELECT * FROM recommended_gear WHERE id = ? AND is_active = 1`)
      .bind(input.gear_id)
      .first<RecommendedGear>();
    if (!gear) return null;
    snapshot = {
      name: gear.name,
      category: gear.category,
      description: gear.description,
      brand: gear.brand,
      weight_grams: gear.weight_grams,
      match_key: gear.match_key,
    };
  } else {
    if (!input.name?.trim() || !input.category?.trim()) return null;
    snapshot = {
      name: input.name.trim(),
      category: input.category.trim(),
      description: input.description ?? null,
      brand: input.brand ?? null,
      weight_grams: input.weight_grams ?? null,
      match_key: matchKey(input.name),
    };
  }
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO wishlist_items
         (id, scout_id, gear_id, name, category, description, brand, weight_grams, match_key, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      scoutId,
      input.gear_id ?? null,
      snapshot.name,
      snapshot.category,
      snapshot.description,
      snapshot.brand,
      snapshot.weight_grams,
      snapshot.match_key,
      input.note?.trim() || null,
    )
    .run();
  return getWishlistItem(db, scoutId, id);
}

async function getWishlistItem(
  db: D1Database,
  scoutId: string,
  itemId: string,
): Promise<WishlistItem | null> {
  const row = await db
    .prepare(`SELECT * FROM wishlist_items WHERE id = ? AND scout_id = ?`)
    .bind(itemId, scoutId)
    .first<Omit<WishlistItem, "options">>();
  if (!row) return null;
  const options = row.gear_id
    ? (await getRecommendedBundle(db, row.gear_id))?.options ?? []
    : [];
  return { ...row, options };
}

export async function removeWishlistItem(
  db: D1Database,
  scoutId: string,
  itemId: string,
): Promise<boolean> {
  const res = await db
    .prepare(`DELETE FROM wishlist_items WHERE id = ? AND scout_id = ?`)
    .bind(itemId, scoutId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

// "Got it": turn a wishlist item into owned closet gear, then drop it from the
// wishlist. Reuses createClosetItem so the new gear auto-relinks to any pending
// packing-list rows by match_key.
export async function fulfillWishlistItem(
  db: D1Database,
  scoutId: string,
  itemId: string,
): Promise<ClosetItem | null> {
  const row = await db
    .prepare(`SELECT * FROM wishlist_items WHERE id = ? AND scout_id = ?`)
    .bind(itemId, scoutId)
    .first<Omit<WishlistItem, "options">>();
  if (!row) return null;
  const created = await createClosetItem(db, scoutId, {
    name: row.name,
    category: row.category,
    description: row.description,
    brand: row.brand,
    weight_grams: row.weight_grams,
    quantity: 1,
  });
  await db.prepare(`DELETE FROM wishlist_items WHERE id = ?`).bind(itemId).run();
  return created;
}

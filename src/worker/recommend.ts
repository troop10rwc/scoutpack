import type {
  ClosetItem,
  RecommendationSet,
  RecommendationSetBundle,
  RecommendedGear,
  RecommendedGearBundle,
  RecommendedGearOption,
  WishlistItem,
} from "../shared/types.ts";
import { matchKey } from "../shared/slug.ts";
import { createClosetItem } from "./gear.ts";

// ============================================================================
// Recommendation catalog: a "set" is one gear need (e.g. "Backpacking sleeping
// bag") holding 1-N product *picks*, each with its own buy options. Template
// lines link to a set; the scout picks one product for their wishlist.
// ============================================================================

export interface RecommendedOptionInput {
  vendor: string;
  price_cents?: number | null;
  url?: string | null;
  note?: string | null;
}

export interface RecommendationPickInput {
  id?: string; // present => update this pick in place; absent => new pick
  name: string;
  brand?: string | null;
  weight_grams?: number | null;
  pick_label?: string | null;
  rationale?: string | null;
  options: RecommendedOptionInput[];
}

export interface RecommendationSetInput {
  name: string;
  category: string;
  description?: string | null;
  sort_order?: number;
  picks: RecommendationPickInput[];
}

// Group a flat option list under its gear (pick) id.
function groupOptions(rows: RecommendedGearOption[]): Map<string, RecommendedGearOption[]> {
  const byGear = new Map<string, RecommendedGearOption[]>();
  for (const o of rows) {
    const arr = byGear.get(o.gear_id) ?? [];
    arr.push(o);
    byGear.set(o.gear_id, arr);
  }
  return byGear;
}

// Hydrate sets → picks → options for a set of set-ids (3 queries, grouped in JS;
// D1 has no cross-table hydration). Shared by list/get/by-ids.
async function hydrateSets(
  db: D1Database,
  sets: RecommendationSet[],
): Promise<RecommendationSetBundle[]> {
  if (!sets.length) return [];
  const setIds = sets.map((s) => s.id);
  const ph = setIds.map(() => "?").join(",");
  const { results: picks } = await db
    .prepare(
      `SELECT * FROM recommended_gear WHERE set_id IN (${ph}) ORDER BY sort_order, name`,
    )
    .bind(...setIds)
    .all<RecommendedGear>();
  const pickList = picks ?? [];
  let byGear = new Map<string, RecommendedGearOption[]>();
  if (pickList.length) {
    const gph = pickList.map(() => "?").join(",");
    const { results: opts } = await db
      .prepare(
        `SELECT * FROM recommended_gear_options WHERE gear_id IN (${gph})
          ORDER BY sort_order, vendor`,
      )
      .bind(...pickList.map((p) => p.id))
      .all<RecommendedGearOption>();
    byGear = groupOptions(opts ?? []);
  }
  const picksBySet = new Map<string, RecommendedGearBundle[]>();
  for (const p of pickList) {
    const arr = picksBySet.get(p.set_id ?? "") ?? [];
    arr.push({ gear: p, options: byGear.get(p.id) ?? [] });
    picksBySet.set(p.set_id ?? "", arr);
  }
  return sets.map((s) => ({ set: s, picks: picksBySet.get(s.id) ?? [] }));
}

export async function listRecommendationSets(
  db: D1Database,
  includeArchived = false,
): Promise<RecommendationSetBundle[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM recommendation_sets
        ${includeArchived ? "" : "WHERE is_active = 1"}
        ORDER BY category, sort_order, name`,
    )
    .all<RecommendationSet>();
  return hydrateSets(db, results ?? []);
}

export async function getRecommendationSetBundle(
  db: D1Database,
  id: string,
): Promise<RecommendationSetBundle | null> {
  const set = await db
    .prepare(`SELECT * FROM recommendation_sets WHERE id = ?`)
    .bind(id)
    .first<RecommendationSet>();
  if (!set) return null;
  return (await hydrateSets(db, [set]))[0] ?? null;
}

// Load several set bundles by id (attaches suggestions to a packing list with no
// N+1). Keyed by set id.
export async function loadRecommendationSetsByIds(
  db: D1Database,
  ids: string[],
): Promise<Map<string, RecommendationSetBundle>> {
  const map = new Map<string, RecommendationSetBundle>();
  const unique = [...new Set(ids)];
  if (!unique.length) return map;
  const ph = unique.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT * FROM recommendation_sets WHERE id IN (${ph})`)
    .bind(...unique)
    .all<RecommendationSet>();
  for (const b of await hydrateSets(db, results ?? [])) map.set(b.set.id, b);
  return map;
}

// Load specific picks (by gear id) with their options — used by the wishlist to
// resolve a chosen pick's live buy options + label. Keyed by gear id.
export async function loadPickBundlesByIds(
  db: D1Database,
  ids: string[],
): Promise<Map<string, RecommendedGearBundle>> {
  const map = new Map<string, RecommendedGearBundle>();
  const unique = [...new Set(ids)];
  if (!unique.length) return map;
  const ph = unique.map(() => "?").join(",");
  const { results: picks } = await db
    .prepare(`SELECT * FROM recommended_gear WHERE id IN (${ph})`)
    .bind(...unique)
    .all<RecommendedGear>();
  const list = picks ?? [];
  if (!list.length) return map;
  const { results: opts } = await db
    .prepare(
      `SELECT * FROM recommended_gear_options WHERE gear_id IN (${ph})
        ORDER BY sort_order, vendor`,
    )
    .bind(...unique)
    .all<RecommendedGearOption>();
  const byGear = groupOptions(opts ?? []);
  for (const g of list) map.set(g.id, { gear: g, options: byGear.get(g.id) ?? [] });
  return map;
}

// Statements that (re)write a pick's buy options: clear then re-insert.
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

// Insert a pick under a set; returns the statements (caller batches them).
function insertPickStmts(
  db: D1Database,
  setId: string,
  category: string,
  pick: RecommendationPickInput,
  sortOrder: number,
  updatedBy: string,
): D1PreparedStatement[] {
  const id = pick.id ?? crypto.randomUUID();
  return [
    db
      .prepare(
        `INSERT INTO recommended_gear
           (id, set_id, name, category, brand, weight_grams, pick_label, rationale,
            match_key, sort_order, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        setId,
        pick.name,
        category,
        pick.brand ?? null,
        pick.weight_grams ?? null,
        pick.pick_label ?? null,
        pick.rationale ?? null,
        matchKey(pick.name),
        sortOrder,
        updatedBy,
      ),
    ...optionStmts(db, id, pick.options ?? []),
  ];
}

export async function createRecommendationSet(
  db: D1Database,
  input: RecommendationSetInput,
  updatedBy: string,
): Promise<RecommendationSetBundle> {
  const setId = crypto.randomUUID();
  const row = await db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM recommendation_sets WHERE category = ?`)
    .bind(input.category)
    .first<{ n: number }>();
  const sortOrder = input.sort_order ?? row?.n ?? 0;
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO recommendation_sets
           (id, name, category, description, match_key, sort_order, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        setId,
        input.name,
        input.category,
        input.description ?? null,
        matchKey(input.name),
        sortOrder,
        updatedBy,
      ),
  ];
  input.picks
    .filter((p) => p.name?.trim())
    .forEach((p, i) =>
      stmts.push(...insertPickStmts(db, setId, input.category, { ...p, id: undefined }, i * 10, updatedBy)),
    );
  await db.batch(stmts);
  const bundle = await getRecommendationSetBundle(db, setId);
  if (!bundle) throw new Error("failed to create recommendation set");
  return bundle;
}

// In-place update of a set: update the set row, then reconcile picks — update
// those the client still has (by id), insert new ones, delete those it dropped.
// Preserving kept pick ids keeps wishlist links (gear_id) live.
export async function updateRecommendationSet(
  db: D1Database,
  setId: string,
  input: RecommendationSetInput,
  updatedBy: string,
): Promise<RecommendationSetBundle | null> {
  const existing = await db
    .prepare(`SELECT id FROM recommendation_sets WHERE id = ?`)
    .bind(setId)
    .first<{ id: string }>();
  if (!existing) return null;
  const { results: current } = await db
    .prepare(`SELECT id FROM recommended_gear WHERE set_id = ?`)
    .bind(setId)
    .all<{ id: string }>();
  const currentIds = new Set((current ?? []).map((r) => r.id));
  const keptIds = new Set(
    input.picks.map((p) => p.id).filter((x): x is string => !!x && currentIds.has(x)),
  );

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE recommendation_sets
            SET name=?, category=?, description=?, match_key=?, updated_by=?, updated_at=datetime('now')
          WHERE id=?`,
      )
      .bind(input.name, input.category, input.description ?? null, matchKey(input.name), updatedBy, setId),
  ];
  // Drop picks the client removed (cascades their options).
  for (const id of currentIds) {
    if (!keptIds.has(id)) {
      stmts.push(db.prepare(`DELETE FROM recommended_gear WHERE id = ?`).bind(id));
    }
  }
  input.picks
    .filter((p) => p.name?.trim())
    .forEach((p, i) => {
      const sortOrder = i * 10;
      if (p.id && keptIds.has(p.id)) {
        stmts.push(
          db
            .prepare(
              `UPDATE recommended_gear
                  SET name=?, category=?, brand=?, weight_grams=?, pick_label=?, rationale=?,
                      match_key=?, sort_order=?, updated_by=?, updated_at=datetime('now')
                WHERE id=?`,
            )
            .bind(
              p.name,
              input.category,
              p.brand ?? null,
              p.weight_grams ?? null,
              p.pick_label ?? null,
              p.rationale ?? null,
              matchKey(p.name),
              sortOrder,
              updatedBy,
              p.id,
            ),
          ...optionStmts(db, p.id, p.options ?? []),
        );
      } else {
        stmts.push(
          ...insertPickStmts(db, setId, input.category, { ...p, id: undefined }, sortOrder, updatedBy),
        );
      }
    });
  await db.batch(stmts);
  return getRecommendationSetBundle(db, setId);
}

export async function archiveRecommendationSet(db: D1Database, id: string): Promise<boolean> {
  const res = await db
    .prepare(`UPDATE recommendation_sets SET is_active = 0, updated_at = datetime('now') WHERE id = ?`)
    .bind(id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

// ---------- CSV bulk load ----------

// Minimal RFC-4180-ish parser: handles quoted fields, escaped "" quotes, and
// CRLF/LF line endings. Returns rows of string cells.
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // ignore; \n handles the break
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function dollarsToCents(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

// One "vendor|price|url|note" list (separated by ";") → option inputs. Price in
// dollars; url and note optional (a 3-part triple still parses).
function parseBuyOptions(cell: string): RecommendedOptionInput[] {
  if (!cell?.trim()) return [];
  return cell
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((piece) => {
      const [vendor, price, url, note] = piece.split("|").map((x) => (x ?? "").trim());
      return {
        vendor,
        price_cents: dollarsToCents(price ?? ""),
        url: url || null,
        note: note || null,
      };
    })
    .filter((o) => o.vendor);
}

export interface ParsedCsvPick {
  id: string | null; // from the export's product_id column (matches in place)
  name: string;
  brand: string | null;
  weight_grams: number | null;
  pick_label: string | null;
  rationale: string | null;
  match_key: string;
  options: RecommendedOptionInput[];
}
export interface ParsedCsvSet {
  id: string | null; // from the export's set_id column (matches in place)
  name: string;
  category: string;
  description: string | null;
  match_key: string;
  picks: ParsedCsvPick[];
}

export class CsvError extends Error {}

// Parse the paste-CSV into grouped sets (order preserved). The optional `set_id`
// / `product_id` columns (present in exported CSVs) let a re-import update the
// exact rows even when names changed; without them we fall back to name slugs.
export function parseRecommendationCsv(text: string): ParsedCsvSet[] {
  const allRows = parseCsvRows(text).filter((r) => r.some((c) => c.trim()));
  // Tolerate a prose/prompt preamble above the CSV (e.g. the "copy for an AI
  // agent" export): the header is the first row that has both `set` and
  // `product` cells; anything before it is ignored.
  const headerIdx = allRows.findIndex((r) => {
    const cells = r.map((c) => c.trim().toLowerCase());
    return cells.includes("set") && cells.includes("product");
  });
  if (headerIdx < 0) {
    throw new CsvError("Couldn't find a header row with `set` and `product` columns.");
  }
  const rows = allRows.slice(headerIdx);
  if (rows.length < 2) throw new CsvError("Need a header row and at least one data row.");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iSet = col("set");
  const iProduct = col("product");
  const iSetId = col("set_id");
  const iProductId = col("product_id");
  const iCat = col("category");
  const iHow = col("how_to_choose");
  const iLabel = col("label");
  const iBrand = col("brand");
  const iWeight = col("weight_g");
  const iRationale = col("rationale");
  const iBuy = col("buy_options");
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

  const bySet = new Map<string, ParsedCsvSet>();
  const order: string[] = [];
  for (const r of rows.slice(1)) {
    const setName = at(r, iSet);
    const product = at(r, iProduct);
    if (!setName || !product) continue;
    const setId = at(r, iSetId) || null;
    // Group by explicit id when present (rename-safe), else by the name slug.
    const key = setId ? `id:${setId}` : matchKey(setName);
    let set = bySet.get(key);
    if (!set) {
      set = {
        id: setId,
        name: setName,
        category: at(r, iCat) || "Misc",
        description: at(r, iHow) || null,
        match_key: matchKey(setName),
        picks: [],
      };
      bySet.set(key, set);
      order.push(key);
    }
    if ((!set.category || set.category === "Misc") && at(r, iCat)) set.category = at(r, iCat);
    if (!set.description && at(r, iHow)) set.description = at(r, iHow);
    const w = at(r, iWeight);
    set.picks.push({
      id: at(r, iProductId) || null,
      name: product,
      brand: at(r, iBrand) || null,
      weight_grams: w ? Number(w) || null : null,
      pick_label: at(r, iLabel) || null,
      rationale: at(r, iRationale) || null,
      match_key: matchKey(product),
      options: parseBuyOptions(at(r, iBuy)),
    });
  }
  const out = order.map((k) => bySet.get(k)!);
  if (!out.length) throw new CsvError("No rows with both a set and a product.");
  return out;
}

// The live set a parsed row targets: by explicit id first (rename-safe), else by
// name slug among active sets.
async function findExistingSetId(db: D1Database, s: ParsedCsvSet): Promise<string | null> {
  if (s.id) {
    const byId = await db
      .prepare(`SELECT id FROM recommendation_sets WHERE id = ?`)
      .bind(s.id)
      .first<{ id: string }>();
    if (byId) return byId.id;
  }
  const byKey = await db
    .prepare(`SELECT id FROM recommendation_sets WHERE match_key = ? AND is_active = 1`)
    .bind(s.match_key)
    .first<{ id: string }>();
  return byKey?.id ?? null;
}

export interface CsvPreview {
  sets: Array<{ name: string; status: "new" | "update"; picks: number; newPicks: number }>;
  setCount: number;
  pickCount: number;
}

// Diff a parsed CSV against the live catalog. No writes.
export async function previewCsvImport(db: D1Database, text: string): Promise<CsvPreview> {
  const parsed = parseRecommendationCsv(text);
  const sets: CsvPreview["sets"] = [];
  let pickCount = 0;
  for (const s of parsed) {
    pickCount += s.picks.length;
    const existingId = await findExistingSetId(db, s);
    let newPicks = s.picks.length;
    if (existingId) {
      const { results } = await db
        .prepare(`SELECT id, match_key FROM recommended_gear WHERE set_id = ?`)
        .bind(existingId)
        .all<{ id: string; match_key: string }>();
      const ids = new Set((results ?? []).map((r) => r.id));
      const keys = new Set((results ?? []).map((r) => r.match_key));
      newPicks = s.picks.filter((p) => !(p.id && ids.has(p.id)) && !keys.has(p.match_key)).length;
    }
    sets.push({
      name: s.name,
      status: existingId ? "update" : "new",
      picks: s.picks.length,
      newPicks,
    });
  }
  return { sets, setCount: parsed.length, pickCount };
}

// Upsert the parsed CSV. Sets/picks match by explicit id first (rename-safe; a
// pick can even move sets), then by name slug. Non-destructive — never deletes
// sets/picks absent from the CSV.
export async function applyCsvImport(
  db: D1Database,
  text: string,
  updatedBy: string,
): Promise<{ sets: number; picks: number }> {
  const parsed = parseRecommendationCsv(text);
  let setCount = 0;
  let pickCount = 0;
  for (const s of parsed) {
    let setId = await findExistingSetId(db, s);
    if (setId) {
      await db
        .prepare(
          `UPDATE recommendation_sets
              SET name=?, category=?, description=?, match_key=?, updated_by=?, updated_at=datetime('now')
            WHERE id=?`,
        )
        .bind(s.name, s.category, s.description, s.match_key, updatedBy, setId)
        .run();
    } else {
      setId = crypto.randomUUID();
      const row = await db
        .prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM recommendation_sets WHERE category = ?`)
        .bind(s.category)
        .first<{ n: number }>();
      await db
        .prepare(
          `INSERT INTO recommendation_sets (id, name, category, description, match_key, sort_order, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(setId, s.name, s.category, s.description, s.match_key, row?.n ?? 0, updatedBy)
        .run();
    }
    setCount++;
    for (const [i, p] of s.picks.entries()) {
      let pickId: string | null = null;
      if (p.id) {
        const byId = await db
          .prepare(`SELECT id FROM recommended_gear WHERE id = ?`)
          .bind(p.id)
          .first<{ id: string }>();
        pickId = byId?.id ?? null;
      }
      if (!pickId) {
        const byKey = await db
          .prepare(`SELECT id FROM recommended_gear WHERE set_id = ? AND match_key = ?`)
          .bind(setId, p.match_key)
          .first<{ id: string }>();
        pickId = byKey?.id ?? null;
      }
      if (pickId) {
        await db
          .prepare(
            `UPDATE recommended_gear
                SET set_id=?, name=?, category=?, brand=?, weight_grams=?, pick_label=?, rationale=?,
                    match_key=?, sort_order=?, updated_by=?, updated_at=datetime('now')
              WHERE id=?`,
          )
          .bind(
            setId, p.name, s.category, p.brand, p.weight_grams, p.pick_label, p.rationale,
            p.match_key, i * 10, updatedBy, pickId,
          )
          .run();
        await db.batch(optionStmts(db, pickId, p.options));
      } else {
        await db.batch(
          insertPickStmts(
            db,
            setId,
            s.category,
            {
              name: p.name,
              brand: p.brand,
              weight_grams: p.weight_grams,
              pick_label: p.pick_label,
              rationale: p.rationale,
              options: p.options,
            },
            i * 10,
            updatedBy,
          ),
        );
      }
      pickCount++;
    }
  }
  return { sets: setCount, picks: pickCount };
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
    .prepare(`SELECT * FROM wishlist_items WHERE scout_id = ? ORDER BY category, created_at`)
    .bind(scoutId)
    .all<Omit<WishlistItem, "options" | "pick_label">>();
  const rows = results ?? [];
  if (!rows.length) return [];
  const gearIds = rows.map((r) => r.gear_id).filter((x): x is string => !!x);
  const picks = await loadPickBundlesByIds(db, gearIds);
  return rows.map((r) => {
    const live = r.gear_id ? picks.get(r.gear_id) : undefined;
    return { ...r, pick_label: live?.gear.pick_label ?? null, options: live?.options ?? [] };
  });
}

// Add a chosen pick (or a free-form item) to a scout's wishlist. With `gear_id`
// the snapshot is copied from the pick server-side; a repeat add of the same
// pick is a no-op (dedupe index) returning the existing row.
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
      .prepare(`SELECT * FROM recommended_gear WHERE id = ?`)
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
    .first<Omit<WishlistItem, "options" | "pick_label">>();
  if (!row) return null;
  const live = row.gear_id ? (await loadPickBundlesByIds(db, [row.gear_id])).get(row.gear_id) : undefined;
  return { ...row, pick_label: live?.gear.pick_label ?? null, options: live?.options ?? [] };
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
    .first<Omit<WishlistItem, "options" | "pick_label">>();
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

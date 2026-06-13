import { Hono } from "hono";
import { requireAuth, requireLeader, type AuthBindings } from "./auth.ts";
import type { User } from "../shared/types.ts";
import { BASE_PATH, EVENT_TYPES, type EventType } from "../shared/constants.ts";
import {
  clearEventGearType,
  getEvent,
  listAllForLeader,
  listUpcoming,
  setEventGearType,
} from "./events.ts";
import {
  assertScoutOwned,
  createScout,
  ensureAccount,
  ensureDefaultScout,
  listScouts,
} from "./profiles.ts";
import {
  isValidPosition,
  listRoster,
  requireRoleManager,
  setOverride,
} from "./roster.ts";
import {
  addPackingListItem,
  attachPackingStats,
  createPackingList,
  deleteClosetItem,
  createClosetItem,
  deletePackingList,
  deletePackingListItem,
  getActiveTemplate,
  getClosetItem,
  importClosetItems,
  listActiveTemplates,
  listCloset,
  loadPackingListBundle,
  previewClosetImport,
  publishTemplate,
  reorderCloset,
  reorderPackingItems,
  setClosetImageKey,
  updateClosetItem,
  updatePackingListItem,
  type ClosetItemInput,
} from "./gear.ts";
import {
  addToWishlist,
  applyCsvImport,
  archiveRecommendationSet,
  createRecommendationSet,
  CsvError,
  fulfillWishlistItem,
  listRecommendationSets,
  listWishlist,
  previewCsvImport,
  removeWishlistItem,
  updateRecommendationSet,
  type RecommendationSetInput,
  type WishlistInput,
} from "./recommend.ts";

interface Bindings extends AuthBindings {
  ASSETS: Fetcher;
  IMAGES: R2Bucket;
  ENVIRONMENT?: string;
}

type Env = { Bindings: Bindings; Variables: { user: User; accountId: string } };

const app = new Hono<Env>();
const api = new Hono<Env>();

api.use("*", requireAuth);
// Ensure the calling identity has an account + at least one scout profile.
api.use("*", async (c, next) => {
  const u = c.get("user");
  const accountId = await ensureAccount(c.env.DB, u.email);
  await ensureDefaultScout(c.env.DB, accountId, u.name);
  c.set("accountId", accountId);
  await next();
});

const bad = (msg: string) => ({ error: msg });
const handleError = (e: unknown) => {
  const err = e as Error & { status?: number };
  const status = err.status ?? 500;
  return { body: { error: err.message ?? "internal error" }, status };
};

// ---- me / profiles ----
api.get("/me", async (c) => {
  const u = c.get("user");
  const scouts = await listScouts(c.env.DB, c.get("accountId"));
  return c.json({
    email: u.email,
    name: u.name,
    role: u.role,
    override: u.override,
    rosterPositions: u.rosterPositions,
    scouts,
  });
});

// ---- roster / roles ----
// Leader-only: every known member with roster-derived positions + any override.
api.get("/roster", async (c) => {
  try {
    requireRoleManager(c);
  } catch (e) {
    const { body, status } = handleError(e);
    return c.json(body, status as 403);
  }
  return c.json(await listRoster(c.env.DB, c.env.ROSTER));
});

// Leader-only: set (or clear) a member's override. Body: { position: Position | null }.
// Clearing reverts the member to roster-db / Access-group resolution.
api.put("/roster/:email", async (c) => {
  try {
    requireRoleManager(c);
  } catch (e) {
    const { body, status } = handleError(e);
    return c.json(body, status as 403);
  }
  const email = decodeURIComponent(c.req.param("email")).trim();
  if (!email || !email.includes("@")) return c.json(bad("a valid email is required"), 400);
  const body = await c.req.json<{ position: string | null }>();
  if (body.position !== null && !isValidPosition(body.position)) {
    return c.json(bad("invalid position"), 400);
  }
  // Guard against self-lockout: a role manager can't set an override that would
  // revoke their own leader access (it'd block them from ever undoing it).
  const me = c.get("user");
  if (email.toLowerCase() === me.email.toLowerCase() && body.position === "scout") {
    return c.json(bad("you can't revoke your own leader access"), 400);
  }
  await setOverride(c.env.DB, email, body.position, me.email);
  return c.json({ ok: true, email: email.toLowerCase(), override: body.position });
});

api.post("/me/scouts", async (c) => {
  const body = await c.req.json<{ display_name?: string }>();
  if (!body.display_name?.trim()) return c.json(bad("display_name is required"), 400);
  const scout = await createScout(c.env.DB, c.get("accountId"), body.display_name.trim());
  return c.json(scout, 201);
});

// ---- events ----
api.get("/events/upcoming", async (c) => {
  const events = await listUpcoming(c.env.EVENTS, c.env.DB);
  const scoutId = c.req.query("scout_id");
  if (scoutId) {
    try {
      await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
    } catch (e) {
      const { body, status } = handleError(e);
      return c.json(body, status as 403);
    }
    return c.json(await attachPackingStats(c.env.DB, scoutId, events));
  }
  return c.json(events.map((e) => ({ ...e, packing: null })));
});

// Leader-only "tag events" view: every upcoming calendar event, including
// untyped ones, with the effective gear type and override flag.
api.get("/events/all", async (c) => {
  try {
    requireLeader(c);
  } catch (e) {
    const { body, status } = handleError(e);
    return c.json(body, status as 403);
  }
  return c.json(await listAllForLeader(c.env.EVENTS, c.env.DB));
});

// Leader-only: set or clear the gear-type override for one event.
api.put("/events/:eventId/gear-type", async (c) => {
  try {
    requireLeader(c);
  } catch (e) {
    const { body, status } = handleError(e);
    return c.json(body, status as 403);
  }
  const eventId = c.req.param("eventId");
  const body = await c.req.json<{ gear_type: string | null }>();
  if (body.gear_type === null) {
    await clearEventGearType(c.env.DB, eventId);
    return c.json({ ok: true, gear_type: null });
  }
  if (!EVENT_TYPES.includes(body.gear_type as EventType)) {
    return c.json(bad("invalid gear_type"), 400);
  }
  const u = c.get("user");
  await setEventGearType(c.env.DB, eventId, body.gear_type as EventType, u.email);
  return c.json({ ok: true, gear_type: body.gear_type });
});

// ---- closet ----
api.get("/scouts/:scoutId/closet", async (c) => {
  const scoutId = c.req.param("scoutId");
  try {
    await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  } catch (e) {
    const { body, status } = handleError(e);
    return c.json(body, status as 403);
  }
  return c.json(await listCloset(c.env.DB, scoutId));
});

api.post("/scouts/:scoutId/closet", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const body = await c.req.json<{
    name: string;
    description?: string;
    brand?: string;
    category: string;
    weight_grams?: number | null;
    quantity?: number;
    is_worn?: boolean;
    is_consumable?: boolean;
    is_favorite?: boolean;
    link_url?: string | null;
  }>();
  if (!body.name || !body.category) return c.json(bad("name and category are required"), 400);
  const item = await createClosetItem(c.env.DB, scoutId, body);
  return c.json(item, 201);
});

// Apply a new drag ordering across categories. Body: { order: [{id, category, sort_order}] }.
api.put("/scouts/:scoutId/closet/order", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const body = await c.req.json<{
    order?: { id: string; category: string; sort_order: number }[];
  }>();
  if (!Array.isArray(body.order)) return c.json(bad("order is required"), 400);
  const ok = await reorderCloset(c.env.DB, scoutId, body.order);
  return ok ? c.json({ ok: true }) : c.json(bad("no valid items"), 400);
});

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Upload (or replace) an item photo. Raw image bytes in the body; the old R2
// object, if any, is deleted.
api.put("/scouts/:scoutId/closet/:itemId/image", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const itemId = c.req.param("itemId");
  const item = await getClosetItem(c.env.DB, scoutId, itemId);
  if (!item) return c.json(bad("item not found"), 404);
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.startsWith("image/")) return c.json(bad("expected an image upload"), 400);
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) return c.json(bad("empty upload"), 400);
  if (bytes.byteLength > MAX_IMAGE_BYTES) return c.json(bad("image too large (max 5 MB)"), 413);
  const ext = contentType.split("/")[1]?.split("+")[0]?.replace(/[^a-z0-9]/gi, "") || "bin";
  const key = `closet/${scoutId}/${itemId}/${crypto.randomUUID()}.${ext}`;
  await c.env.IMAGES.put(key, bytes, { httpMetadata: { contentType } });
  if (item.image_key) await c.env.IMAGES.delete(item.image_key).catch(() => {});
  const updated = await setClosetImageKey(c.env.DB, scoutId, itemId, key);
  return c.json(updated, 200);
});

// Remove an item photo.
api.delete("/scouts/:scoutId/closet/:itemId/image", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const itemId = c.req.param("itemId");
  const item = await getClosetItem(c.env.DB, scoutId, itemId);
  if (!item) return c.json(bad("item not found"), 404);
  if (item.image_key) await c.env.IMAGES.delete(item.image_key).catch(() => {});
  await setClosetImageKey(c.env.DB, scoutId, itemId, null);
  return c.json({ ok: true });
});

// Stream an item photo from R2 (same-origin, behind Access). Cache-busted by the
// ?k=<image_key> query the client appends.
api.get("/scouts/:scoutId/closet/:itemId/image", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const item = await getClosetItem(c.env.DB, scoutId, c.req.param("itemId"));
  if (!item?.image_key) return c.json(bad("no image"), 404);
  const obj = await c.env.IMAGES.get(item.image_key);
  if (!obj) return c.json(bad("no image"), 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "private, max-age=86400");
  return new Response(obj.body, { headers });
});

// Preview a LighterPack CSV import: fetch + parse, flag duplicates. No writes.
api.post("/scouts/:scoutId/closet/import/preview", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const body = await c.req.json<{ url?: string }>();
  if (!body.url?.trim()) return c.json(bad("url is required"), 400);
  try {
    const items = await previewClosetImport(c.env.DB, scoutId, body.url.trim());
    return c.json({ items });
  } catch (e) {
    const { body: errBody, status } = handleError(e);
    return c.json(errBody, status as 400 | 500);
  }
});

// Commit the user-selected rows from a previewed import into the closet.
api.post("/scouts/:scoutId/closet/import", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const body = await c.req.json<{ items?: ClosetItemInput[] }>();
  if (!Array.isArray(body.items) || !body.items.length) {
    return c.json(bad("items are required"), 400);
  }
  const clean = body.items.filter((i) => i?.name?.trim() && i?.category?.trim());
  if (!clean.length) return c.json(bad("no valid items to import"), 400);
  const created = await importClosetItems(c.env.DB, scoutId, clean);
  return c.json({ items: created, imported: created.length }, 201);
});

api.patch("/scouts/:scoutId/closet/:itemId", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const body = await c.req.json<Record<string, unknown>>();
  const updated = await updateClosetItem(c.env.DB, scoutId, c.req.param("itemId"), body);
  if (!updated) return c.json(bad("item not found"), 404);
  return c.json(updated);
});

api.delete("/scouts/:scoutId/closet/:itemId", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const ok = await deleteClosetItem(c.env.DB, scoutId, c.req.param("itemId"));
  return ok ? c.json({ ok: true }) : c.json(bad("item not found"), 404);
});

// ---- packing lists ----
api.get("/scouts/:scoutId/packing-lists/:eventId", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const event = await getEvent(c.env.EVENTS, c.env.DB, c.req.param("eventId"));
  if (!event) return c.json(bad("event not found"), 404);
  const bundle = await loadPackingListBundle(c.env.DB, scoutId, event);
  if (!bundle) return c.json({ list: null, event, items: [] });
  return c.json(bundle);
});

api.post("/scouts/:scoutId/packing-lists", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const body = await c.req.json<{ event_id: string }>();
  if (!body.event_id) return c.json(bad("event_id is required"), 400);
  const event = await getEvent(c.env.EVENTS, c.env.DB, body.event_id);
  if (!event) return c.json(bad("event not found"), 404);
  try {
    const list = await createPackingList(c.env.DB, scoutId, event);
    const bundle = await loadPackingListBundle(c.env.DB, scoutId, event);
    return c.json(bundle ?? list, 201);
  } catch (e) {
    const { body: errBody, status } = handleError(e);
    return c.json(errBody, status as 400 | 500);
  }
});

// Delete the scout's whole packing list for an event (the binding), letting them
// reattach by generating a fresh list. Dangerous + rarely used; gated in the UI.
api.delete("/scouts/:scoutId/packing-lists/:eventId", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const ok = await deletePackingList(c.env.DB, scoutId, c.req.param("eventId"));
  return ok ? c.json({ ok: true }) : c.json(bad("packing list not found"), 404);
});

// Add an item to an existing packing list. The list is identified by id in the
// body and re-checked for scout ownership inside addPackingListItem.
api.post("/scouts/:scoutId/packing-list-items", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const body = await c.req.json<{
    packing_list_id?: string;
    name?: string;
    category?: string;
    description?: string | null;
    quantity?: number;
    is_worn?: boolean;
    is_consumable?: boolean;
  }>();
  if (!body.packing_list_id || !body.name || !body.category)
    return c.json(bad("packing_list_id, name and category are required"), 400);
  const item = await addPackingListItem(c.env.DB, scoutId, body.packing_list_id, {
    name: body.name,
    category: body.category,
    description: body.description ?? null,
    quantity: body.quantity,
    is_worn: body.is_worn,
    is_consumable: body.is_consumable,
  });
  return item ? c.json(item, 201) : c.json(bad("packing list not found"), 404);
});

api.patch("/scouts/:scoutId/packing-list-items/:itemId", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const body = await c.req.json<{
    packed?: boolean;
    quantity?: number;
    closet_item_id?: string | null;
    name?: string;
    category?: string;
    description?: string | null;
    is_worn?: boolean;
    is_consumable?: boolean;
  }>();
  const item = await updatePackingListItem(c.env.DB, scoutId, c.req.param("itemId"), body);
  return item ? c.json(item) : c.json(bad("item not found"), 404);
});

api.delete("/scouts/:scoutId/packing-list-items/:itemId", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const ok = await deletePackingListItem(c.env.DB, scoutId, c.req.param("itemId"));
  return ok ? c.json({ ok: true }) : c.json(bad("item not found"), 404);
});

// Apply a new drag ordering across packing-list categories.
// Body: { order: [{id, category, sort_order}] }.
api.put("/scouts/:scoutId/packing-list-items/order", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const body = await c.req.json<{
    order?: { id: string; category: string; sort_order: number }[];
  }>();
  if (!Array.isArray(body.order)) return c.json(bad("order is required"), 400);
  const ok = await reorderPackingItems(c.env.DB, scoutId, body.order);
  return ok ? c.json({ ok: true }) : c.json(bad("no valid items"), 400);
});

// ---- templates ----
api.get("/templates", async (c) => {
  return c.json(await listActiveTemplates(c.env.DB));
});

api.get("/templates/:eventType", async (c) => {
  const t = c.req.param("eventType") as EventType;
  if (!EVENT_TYPES.includes(t)) return c.json(bad("invalid event_type"), 400);
  const bundle = await getActiveTemplate(c.env.DB, t);
  if (!bundle) return c.json(bad("no active template"), 404);
  return c.json(bundle);
});

api.post("/templates/:eventType", async (c) => {
  try {
    requireLeader(c);
  } catch (e) {
    const { body, status } = handleError(e);
    return c.json(body, status as 403);
  }
  const t = c.req.param("eventType") as EventType;
  if (!EVENT_TYPES.includes(t)) return c.json(bad("invalid event_type"), 400);
  const body = await c.req.json<{ name?: string; items?: unknown[] }>();
  if (!body.name || !Array.isArray(body.items))
    return c.json(bad("name and items are required"), 400);
  const u = c.get("user");
  const bundle = await publishTemplate(c.env.DB, t, u.email, {
    name: body.name,
    items: body.items as Parameters<typeof publishTemplate>[3]["items"],
  });
  return c.json(bundle, 201);
});

// ---- recommendation sets (leader-curated catalog) ----
// Readable by any authed user (scouts browse to wishlist). Leaders see archived
// sets too when ?include_archived=1.
api.get("/recommendation-sets", async (c) => {
  const includeArchived =
    c.req.query("include_archived") === "1" && c.get("user").role === "leader";
  return c.json(await listRecommendationSets(c.env.DB, includeArchived));
});

api.post("/recommendation-sets", async (c) => {
  try {
    requireLeader(c);
  } catch (e) {
    const { body, status } = handleError(e);
    return c.json(body, status as 403);
  }
  const body = await c.req.json<Partial<RecommendationSetInput>>();
  if (!body.name?.trim() || !body.category?.trim())
    return c.json(bad("name and category are required"), 400);
  const bundle = await createRecommendationSet(
    c.env.DB,
    { ...(body as RecommendationSetInput), picks: body.picks ?? [] },
    c.get("user").email,
  );
  return c.json(bundle, 201);
});

api.patch("/recommendation-sets/:id", async (c) => {
  try {
    requireLeader(c);
  } catch (e) {
    const { body, status } = handleError(e);
    return c.json(body, status as 403);
  }
  const body = await c.req.json<Partial<RecommendationSetInput>>();
  if (!body.name?.trim() || !body.category?.trim())
    return c.json(bad("name and category are required"), 400);
  const bundle = await updateRecommendationSet(
    c.env.DB,
    c.req.param("id"),
    { ...(body as RecommendationSetInput), picks: body.picks ?? [] },
    c.get("user").email,
  );
  return bundle ? c.json(bundle) : c.json(bad("not found"), 404);
});

api.post("/recommendation-sets/:id/archive", async (c) => {
  try {
    requireLeader(c);
  } catch (e) {
    const { body, status } = handleError(e);
    return c.json(body, status as 403);
  }
  const ok = await archiveRecommendationSet(c.env.DB, c.req.param("id"));
  return ok ? c.json({ ok: true }) : c.json(bad("not found"), 404);
});

// Bulk load from pasted CSV: preview (no writes) then apply (upsert). Leader-only.
api.post("/recommendation-sets/import/preview", async (c) => {
  try {
    requireLeader(c);
  } catch (e) {
    const { body, status } = handleError(e);
    return c.json(body, status as 403);
  }
  const body = await c.req.json<{ csv?: string }>();
  if (!body.csv?.trim()) return c.json(bad("csv is required"), 400);
  try {
    return c.json(await previewCsvImport(c.env.DB, body.csv));
  } catch (e) {
    if (e instanceof CsvError) return c.json(bad(e.message), 400);
    throw e;
  }
});

api.post("/recommendation-sets/import", async (c) => {
  try {
    requireLeader(c);
  } catch (e) {
    const { body, status } = handleError(e);
    return c.json(body, status as 403);
  }
  const body = await c.req.json<{ csv?: string }>();
  if (!body.csv?.trim()) return c.json(bad("csv is required"), 400);
  try {
    const result = await applyCsvImport(c.env.DB, body.csv, c.get("user").email);
    return c.json(result, 201);
  } catch (e) {
    if (e instanceof CsvError) return c.json(bad(e.message), 400);
    throw e;
  }
});

// ---- wishlist (per-scout) ----
api.get("/scouts/:scoutId/wishlist", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  return c.json(await listWishlist(c.env.DB, scoutId));
});

api.post("/scouts/:scoutId/wishlist", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const body = await c.req.json<WishlistInput>();
  if (!body.gear_id && !body.name?.trim())
    return c.json(bad("gear_id or name is required"), 400);
  const item = await addToWishlist(c.env.DB, scoutId, body);
  return item ? c.json(item, 201) : c.json(bad("could not add to wishlist"), 400);
});

api.delete("/scouts/:scoutId/wishlist/:itemId", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const ok = await removeWishlistItem(c.env.DB, scoutId, c.req.param("itemId"));
  return ok ? c.json({ ok: true }) : c.json(bad("item not found"), 404);
});

// "Got it": create the closet item and drop the wishlist row.
api.post("/scouts/:scoutId/wishlist/:itemId/fulfill", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const closetItem = await fulfillWishlistItem(c.env.DB, scoutId, c.req.param("itemId"));
  return closetItem ? c.json(closetItem, 201) : c.json(bad("item not found"), 404);
});

api.notFound((c) => c.json(bad("not found"), 404));

app.route("/api", api);

// Mount handler — strips /manage/gearlist prefix, routes /api to Hono, else SPA.
export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(BASE_PATH)) {
      return new Response("Not found", { status: 404 });
    }
    const rel = url.pathname.slice(BASE_PATH.length) || "/";

    if (rel === "/api" || rel.startsWith("/api/")) {
      const inner = new URL(url);
      inner.pathname = rel;
      return app.fetch(new Request(inner.toString(), request), env, ctx);
    }

    // In dev Vite expects the /manage/gearlist-prefixed path; in prod the built files
    // live at root, so the prefix is stripped.
    if (env.ENVIRONMENT === "development") {
      return env.ASSETS.fetch(request);
    }
    const assetUrl = new URL(url);
    assetUrl.pathname = rel;
    return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  },
};

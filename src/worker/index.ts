import { Hono } from "hono";
import { requireAuth, requireLeader, type AuthBindings } from "./auth.ts";
import type { Identity } from "../shared/types.ts";
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
  attachPackingStats,
  createPackingList,
  deleteClosetItem,
  createClosetItem,
  getActiveTemplate,
  importClosetItems,
  listActiveTemplates,
  listCloset,
  loadPackingListBundle,
  previewClosetImport,
  publishTemplate,
  updateClosetItem,
  updatePackingListItem,
  type ClosetItemInput,
} from "./gear.ts";

interface Bindings extends AuthBindings {
  ASSETS: Fetcher;
  ENVIRONMENT?: string;
}

type Env = { Bindings: Bindings; Variables: { user: Identity; accountId: string } };

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
  return c.json({ email: u.email, name: u.name, role: u.role, scouts });
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
  }>();
  if (!body.name || !body.category) return c.json(bad("name and category are required"), 400);
  const item = await createClosetItem(c.env.DB, scoutId, body);
  return c.json(item, 201);
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

api.patch("/scouts/:scoutId/packing-list-items/:itemId", async (c) => {
  const scoutId = c.req.param("scoutId");
  await assertScoutOwned(c.env.DB, c.get("accountId"), scoutId);
  const body = await c.req.json<{
    packed?: boolean;
    quantity?: number;
    closet_item_id?: string | null;
  }>();
  const ok = await updatePackingListItem(c.env.DB, scoutId, c.req.param("itemId"), body);
  return ok ? c.json({ ok: true }) : c.json(bad("item not found"), 404);
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

api.notFound((c) => c.json(bad("not found"), 404));

app.route("/api", api);

// Mount handler — strips /gearlist prefix, routes /api to Hono, else SPA.
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

    // In dev Vite expects the /gearlist-prefixed path; in prod the built files
    // live at root, so the prefix is stripped.
    if (env.ENVIRONMENT === "development") {
      return env.ASSETS.fetch(request);
    }
    const assetUrl = new URL(url);
    assetUrl.pathname = rel;
    return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  },
};

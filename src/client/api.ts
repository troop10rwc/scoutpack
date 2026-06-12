import { BASE_PATH } from "../shared/constants.ts";
import type {
  ClosetItem,
  ImportPreviewItem,
  LeaderEventRow,
  Me,
  PackingItemView,
  PackingListBundle,
  Position,
  RecommendationSetBundle,
  RosterMember,
  Scout,
  TemplateBundle,
  UpcomingEvent,
  WishlistItem,
} from "../shared/types.ts";
import type { EventType } from "../shared/constants.ts";

const API = `${BASE_PATH}/api`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return (await res.json()) as T;
}

export const api = {
  me: () => request<Me>("/me"),
  createScout: (display_name: string) =>
    request<Scout>("/me/scouts", { method: "POST", body: JSON.stringify({ display_name }) }),

  upcomingEvents: (scoutId?: string) =>
    request<UpcomingEvent[]>(
      `/events/upcoming${scoutId ? `?scout_id=${encodeURIComponent(scoutId)}` : ""}`,
    ),

  // Leader-only.
  allEventsForLeader: () => request<LeaderEventRow[]>(`/events/all`),
  setEventGearType: (eventId: string, gearType: EventType | null) =>
    request<{ ok: boolean; gear_type: EventType | null }>(
      `/events/${encodeURIComponent(eventId)}/gear-type`,
      { method: "PUT", body: JSON.stringify({ gear_type: gearType }) },
    ),

  listCloset: (scoutId: string) => request<ClosetItem[]>(`/scouts/${scoutId}/closet`),
  createClosetItem: (scoutId: string, body: Partial<ClosetItem>) =>
    request<ClosetItem>(`/scouts/${scoutId}/closet`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateClosetItem: (scoutId: string, itemId: string, body: Partial<ClosetItem>) =>
    request<ClosetItem>(`/scouts/${scoutId}/closet/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteClosetItem: (scoutId: string, itemId: string) =>
    request<{ ok: boolean }>(`/scouts/${scoutId}/closet/${itemId}`, { method: "DELETE" }),
  reorderCloset: (
    scoutId: string,
    order: { id: string; category: string; sort_order: number }[],
  ) =>
    request<{ ok: boolean }>(`/scouts/${scoutId}/closet/order`, {
      method: "PUT",
      body: JSON.stringify({ order }),
    }),
  uploadClosetImage: async (scoutId: string, itemId: string, file: File) => {
    const res = await fetch(`${API}/scouts/${scoutId}/closet/${itemId}/image`, {
      method: "PUT",
      headers: { "content-type": file.type },
      body: file,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error ?? res.statusText);
    }
    return (await res.json()) as ClosetItem;
  },
  deleteClosetImage: (scoutId: string, itemId: string) =>
    request<{ ok: boolean }>(`/scouts/${scoutId}/closet/${itemId}/image`, { method: "DELETE" }),
  // URL for an item's photo; pass the image_key to bust cache when it changes.
  closetImageUrl: (scoutId: string, itemId: string, imageKey: string) =>
    `${API}/scouts/${scoutId}/closet/${itemId}/image?k=${encodeURIComponent(imageKey)}`,
  previewClosetImport: (scoutId: string, url: string) =>
    request<{ items: ImportPreviewItem[] }>(`/scouts/${scoutId}/closet/import/preview`, {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  importCloset: (scoutId: string, items: Partial<ClosetItem>[]) =>
    request<{ items: ClosetItem[]; imported: number }>(`/scouts/${scoutId}/closet/import`, {
      method: "POST",
      body: JSON.stringify({ items }),
    }),

  getPackingList: (scoutId: string, eventId: string) =>
    request<PackingListBundle | { list: null; event: PackingListBundle["event"]; items: [] }>(
      `/scouts/${scoutId}/packing-lists/${eventId}`,
    ),
  createPackingList: (scoutId: string, eventId: string) =>
    request<PackingListBundle>(`/scouts/${scoutId}/packing-lists`, {
      method: "POST",
      body: JSON.stringify({ event_id: eventId }),
    }),
  updatePackingListItem: (
    scoutId: string,
    itemId: string,
    body: {
      packed?: boolean;
      quantity?: number;
      closet_item_id?: string | null;
      name?: string;
      category?: string;
      description?: string | null;
      is_worn?: boolean;
      is_consumable?: boolean;
    },
  ) =>
    request<PackingItemView>(`/scouts/${scoutId}/packing-list-items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  addPackingListItem: (
    scoutId: string,
    body: {
      packing_list_id: string;
      name: string;
      category: string;
      description?: string | null;
      quantity?: number;
      is_worn?: boolean;
      is_consumable?: boolean;
    },
  ) =>
    request<PackingItemView>(`/scouts/${scoutId}/packing-list-items`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deletePackingListItem: (scoutId: string, itemId: string) =>
    request<{ ok: boolean }>(`/scouts/${scoutId}/packing-list-items/${itemId}`, {
      method: "DELETE",
    }),
  reorderPacking: (
    scoutId: string,
    order: { id: string; category: string; sort_order: number }[],
  ) =>
    request<{ ok: boolean }>(`/scouts/${scoutId}/packing-list-items/order`, {
      method: "PUT",
      body: JSON.stringify({ order }),
    }),

  // Leader-only roster management. setRosterOverride sets the manual override
  // layered on top of roster-db resolution; null clears it.
  listRoster: () => request<RosterMember[]>(`/roster`),
  setRosterOverride: (email: string, position: Position | null) =>
    request<{ ok: boolean; email: string; override: Position | null }>(
      `/roster/${encodeURIComponent(email)}`,
      { method: "PUT", body: JSON.stringify({ position }) },
    ),

  getTemplate: (eventType: EventType) =>
    request<TemplateBundle>(`/templates/${eventType}`),
  publishTemplate: (
    eventType: EventType,
    body: { name: string; items: TemplateBundle["items"] },
  ) =>
    request<TemplateBundle>(`/templates/${eventType}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Recommendation-set catalog. listRecommendationSets is readable by anyone; the
  // create/update/archive/import mutations are leader-only (enforced server-side).
  listRecommendationSets: (includeArchived = false) =>
    request<RecommendationSetBundle[]>(
      `/recommendation-sets${includeArchived ? "?include_archived=1" : ""}`,
    ),
  createRecommendationSet: (body: RecommendationSetInput) =>
    request<RecommendationSetBundle>(`/recommendation-sets`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateRecommendationSet: (id: string, body: RecommendationSetInput) =>
    request<RecommendationSetBundle>(`/recommendation-sets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  archiveRecommendationSet: (id: string) =>
    request<{ ok: boolean }>(`/recommendation-sets/${id}/archive`, { method: "POST" }),
  previewRecommendationCsv: (csv: string) =>
    request<CsvPreview>(`/recommendation-sets/import/preview`, {
      method: "POST",
      body: JSON.stringify({ csv }),
    }),
  importRecommendationCsv: (csv: string) =>
    request<{ sets: number; picks: number }>(`/recommendation-sets/import`, {
      method: "POST",
      body: JSON.stringify({ csv }),
    }),

  // Per-scout wishlist.
  listWishlist: (scoutId: string) => request<WishlistItem[]>(`/scouts/${scoutId}/wishlist`),
  addToWishlist: (scoutId: string, body: WishlistAddInput) =>
    request<WishlistItem>(`/scouts/${scoutId}/wishlist`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  removeWishlist: (scoutId: string, itemId: string) =>
    request<{ ok: boolean }>(`/scouts/${scoutId}/wishlist/${itemId}`, { method: "DELETE" }),
  fulfillWishlist: (scoutId: string, itemId: string) =>
    request<ClosetItem>(`/scouts/${scoutId}/wishlist/${itemId}/fulfill`, { method: "POST" }),
};

// One buy option in the editor payload.
export interface BuyOptionInput {
  vendor: string;
  price_cents?: number | null;
  url?: string | null;
  note?: string | null;
}

// One product pick in the set-editor payload. `id` present => update in place.
export interface RecommendationPickInput {
  id?: string;
  name: string;
  brand?: string | null;
  weight_grams?: number | null;
  pick_label?: string | null;
  rationale?: string | null;
  options: BuyOptionInput[];
}

// Recommendation-set payload sent by the leader editor (ids/match_key server-owned).
export interface RecommendationSetInput {
  name: string;
  category: string;
  description?: string | null;
  picks: RecommendationPickInput[];
}

// Result of the CSV preview: per-set add/update summary.
export interface CsvPreview {
  sets: Array<{ name: string; status: "new" | "update"; picks: number; newPicks: number }>;
  setCount: number;
  pickCount: number;
}

// Adding to a wishlist: a catalog reference, or a free-form item.
export interface WishlistAddInput {
  gear_id?: string | null;
  name?: string;
  category?: string;
  description?: string | null;
  brand?: string | null;
  weight_grams?: number | null;
  note?: string | null;
}

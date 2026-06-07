import { BASE_PATH } from "../shared/constants.ts";
import type {
  ClosetItem,
  ImportPreviewItem,
  LeaderEventRow,
  Me,
  PackingListBundle,
  Position,
  RosterMember,
  Scout,
  TemplateBundle,
  UpcomingEvent,
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
    body: { packed?: boolean; quantity?: number; closet_item_id?: string | null },
  ) =>
    request<{ ok: boolean }>(`/scouts/${scoutId}/packing-list-items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
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
};

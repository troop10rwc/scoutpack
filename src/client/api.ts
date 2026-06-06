import { BASE_PATH } from "../shared/constants.ts";
import type {
  ClosetItem,
  LeaderEventRow,
  Me,
  PackingListBundle,
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

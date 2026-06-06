// The app is mounted under this path on troop10rwc.org (same-origin tab).
// Everything — assets, API, auth, cookies — lives beneath it.
export const BASE_PATH = "/gearlist";

export const EVENT_TYPES = [
  "summer_camp",
  "car_camping",
  "backpacking",
  "day_hike",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  summer_camp: "Summer Camp",
  car_camping: "Car Camping",
  backpacking: "Backpacking",
  day_hike: "Day Hike",
};

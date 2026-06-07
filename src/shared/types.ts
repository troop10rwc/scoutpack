import type { EventType } from "./constants.ts";

export type Role = "scout" | "leader";

// Specific roster titles a member can hold. The first five are leadership
// positions; `scout` is the explicit default (and lets an admin demote someone
// who would otherwise be a leader via the Access group). Order here is the
// display/seniority order used by the roster UI.
export const POSITIONS = [
  "scoutmaster",
  "assistant_scoutmaster",
  "crew_advisor",
  "assistant_crew_advisor",
  "senior_patrol_leader",
  "scout",
] as const;

export type Position = (typeof POSITIONS)[number];

export const POSITION_LABELS: Record<Position, string> = {
  scoutmaster: "Scoutmaster",
  assistant_scoutmaster: "Assistant Scoutmaster",
  crew_advisor: "Crew Advisor",
  assistant_crew_advisor: "Assistant Crew Advisor",
  senior_patrol_leader: "Senior Patrol Leader",
  scout: "Scout",
};

// Positions that confer leader capabilities (template/event editing) AND the
// ability to edit other members' roles. Everything not in this set is a scout.
export const LEADER_POSITIONS: readonly Position[] = [
  "scoutmaster",
  "assistant_scoutmaster",
  "crew_advisor",
  "assistant_crew_advisor",
  "senior_patrol_leader",
];

export interface Identity {
  email: string;
  name: string;
  role: Role;
  // The explicit roster title, if one has been assigned; null means the member
  // has no row and their role came from the Access group fallback (or default).
  position: Position | null;
}

// A row in the roster-management UI: one known member and their position.
export interface RosterMember {
  email: string;
  position: Position | null; // null => no explicit assignment (default scout)
  role: Role;                // effective capability derived from position
  updated_by: string | null;
  updated_at: string | null;
}

export interface Scout {
  id: string;
  account_id: string;
  display_name: string;
  created_at: string;
}

export interface Me {
  email: string;
  name: string;
  role: Role;
  position: Position | null;
  scouts: Scout[];
}

export interface ClosetItem {
  id: string;
  scout_id: string;
  name: string;
  description: string | null;
  brand: string | null;
  category: string;
  weight_grams: number | null;
  quantity: number;
  is_worn: 0 | 1;
  is_consumable: 0 | 1;
  is_favorite: 0 | 1;
  link_url: string | null;
  image_key: string | null; // R2 object key for the item photo, if any
  sort_order: number;
  match_key: string;
  created_at: string;
  updated_at: string;
}

// A single row parsed from an external (LighterPack) CSV, ready to preview
// before importing into the closet. `duplicate` is true when an item with the
// same match_key already exists in the closet or appeared earlier in the CSV.
export interface ImportPreviewItem {
  name: string;
  category: string;
  description: string | null;
  weight_grams: number | null;
  quantity: number;
  is_worn: boolean;
  is_consumable: boolean;
  match_key: string;
  duplicate: boolean;
}

export interface Template {
  id: string;
  event_type: EventType;
  name: string;
  is_active: 0 | 1;
  updated_by: string;
  updated_at: string;
}

export interface TemplateItem {
  id: string;
  template_id: string;
  name: string;
  description: string | null;
  category: string;
  default_qty: number;
  is_worn: 0 | 1;
  is_consumable: 0 | 1;
  match_key: string;
  sort_order: number;
}

export interface TemplateBundle {
  template: Template;
  items: TemplateItem[];
}

export interface PackingList {
  id: string;
  scout_id: string;
  event_id: string;
  template_id: string | null;
  created_at: string;
}

export interface PackingListItem {
  id: string;
  packing_list_id: string;
  name: string;
  description: string | null;
  category: string;
  quantity: number;
  is_worn: 0 | 1;
  is_consumable: 0 | 1;
  match_key: string;
  closet_item_id: string | null;
  packed: 0 | 1;
  sort_order: number;
}

export interface PackingListBundle {
  list: PackingList;
  event: TroopEvent;
  items: (PackingListItem & {
    owned: boolean;
    closet_item: ClosetItem | null;
  })[];
}

export interface TroopEvent {
  id: string;
  name: string;
  start_at: string;
  end_at: string | null;
  event_type: EventType;
}

// Richer payload returned to leaders for the "tag events" workflow. Includes
// untyped events (those whose calendar type is `day`/`overnight`/etc. and
// for which neither a leader override nor the summary heuristic produced a
// gear type) so leaders can promote them.
export interface LeaderEventRow {
  id: string;
  name: string;
  start_at: string;
  end_at: string | null;
  calendar_type: string;            // raw value from calendar-db
  gear_type: EventType | null;      // effective: override > heuristic > null
  override_set: boolean;            // true when leader explicitly tagged
}

export interface UpcomingEvent extends TroopEvent {
  // Per requested scout: has a packing list yet? Stats if so.
  packing: {
    list_id: string;
    total: number;
    owned: number;
    packed: number;
  } | null;
}

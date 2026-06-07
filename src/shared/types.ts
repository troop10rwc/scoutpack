import type { EventType } from "./constants.ts";

export type Role = "scout" | "leader";

// Role resolution has three layers, highest precedence first:
//   1. An explicit OVERRIDE in scoutpack's member_roles table (Position below).
//   2. The member's POSITIONS in the external roster DB (BSA titles), matched
//      by email. Holding any LEADER_ROSTER_POSITION confers leader.
//   3. The Cloudflare Access LEADER_GROUP claim (bootstrap fallback).
// See src/worker/roster.ts (resolution) and src/worker/rosterdb.ts (roster DB).

// Manual override values an admin can assign in member_roles. These are NOT the
// BSA titles — they're a small capability vocabulary layered on top of the
// roster. The five leadership values confer leader; `scout` force-demotes a
// member who would otherwise be a leader via the roster or the Access group.
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

// Override values that confer leader capabilities. `scout` does not.
export const LEADER_POSITIONS: readonly Position[] = [
  "scoutmaster",
  "assistant_scoutmaster",
  "crew_advisor",
  "assistant_crew_advisor",
  "senior_patrol_leader",
];

// BSA position titles (as stored in roster-db's `positions` JSON arrays) that
// confer leader access. Matched case-insensitively. Troop Admin is included as
// it designates elevated app administration.
export const LEADER_ROSTER_POSITIONS = [
  "Scoutmaster",
  "Assistant Scoutmaster",
  "Crew Advisor",
  "Assistant Crew Advisor",
  "Senior Patrol Leader",
  "Troop Admin",
] as const;

export interface Identity {
  email: string;
  name: string;
  role: Role;
  // Manual override from member_roles, if any (null => no override row).
  override: Position | null;
  // Raw BSA titles from the roster DB for this member (empty if not on roster).
  rosterPositions: string[];
}

// A row in the roster-management UI: one known member, their roster-derived
// positions, and any manual override.
export interface RosterMember {
  email: string;
  override: Position | null;   // explicit member_roles override (null => none)
  rosterPositions: string[];   // BSA titles from roster-db
  role: Role;                  // effective capability after all layers
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
  override: Position | null;
  rosterPositions: string[];
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

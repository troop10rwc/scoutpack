import type { EventType } from "./constants.ts";
// Foundational role types come from the shared kit so every troop10rwc app
// agrees on Role / Position / LEADER_POSITIONS. We extend Identity locally
// with the resolved role + roster/override context the kit doesn't model yet.
import {
  LEADER_POSITIONS as KIT_LEADER_POSITIONS,
  type Identity as KitIdentity,
  type Position,
  type Role,
} from "@troop10rwc/shared";

export type { Role, Position };
export const LEADER_POSITIONS = KIT_LEADER_POSITIONS;

// Role resolution has three layers, highest precedence first:
//   1. An explicit OVERRIDE in scoutpack's member_roles table (Position above).
//   2. The member's POSITIONS in the external roster DB (BSA titles), matched
//      by email. Holding any LEADER_ROSTER_POSITION confers leader.
//   3. The Cloudflare Access LEADER_GROUP claim (bootstrap fallback).
// See src/worker/roster.ts (resolution) and src/worker/rosterdb.ts (roster DB).

// Display-ordered Position values, including `scout` as the force-revoke value.
// The kit's LEADER_POSITIONS covers the five leadership values; appending
// `scout` keeps the UI's option order stable.
export const POSITIONS = [...LEADER_POSITIONS, "scout"] as const satisfies readonly Position[];

export const POSITION_LABELS: Record<Position, string> = {
  scoutmaster: "Scoutmaster",
  assistant_scoutmaster: "Assistant Scoutmaster",
  crew_advisor: "Crew Advisor",
  assistant_crew_advisor: "Assistant Crew Advisor",
  senior_patrol_leader: "Senior Patrol Leader",
  scout: "Scout",
};

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

// The kit's Identity carries just the verified Access subject (email + name).
// Scoutpack's resolved identity layers the effective role and the inputs that
// produced it (manual override + roster-derived positions).
export interface Identity extends KitIdentity {
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

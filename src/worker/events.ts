import type { LeaderEventRow, TroopEvent } from "../shared/types.ts";
import { EVENT_TYPES, type EventType } from "../shared/constants.ts";

// Read-only view of the existing troop `calendar-db` (D1), plus override
// lookups in the local scoutpack DB.
//
// `calendar-db` schema:
//   calendar_events(id INTEGER PK, summary TEXT, description TEXT,
//                   start_date TEXT, end_date TEXT,
//                   event_type TEXT CHECK IN
//                     ('day','overnight','service','parent_meeting','plc_meeting'),
//                   ...)
//
// `start_date` / `end_date` are stored in ICS basic format `YYYYMMDDTHHMMSS`
// (e.g. `20260301T180000`), so plain string comparisons against ISO dates
// silently miss; we convert to ISO with substr() before comparing.
//
// The calendar's `event_type` taxonomy doesn't align with the gear-tracker's
// four categories. Resolution order for the effective gear type:
//   1. Leader-set override in `event_gear_types` (authoritative).
//   2. Heuristic on the event summary for `overnight` events.
//   3. Otherwise null — event is not gear-relevant (or untagged).

interface CalendarEventRow {
  id: number | string;
  summary: string;
  start_date: string;
  end_date: string | null;
  event_type: string | null;
}

// "20260301T180000" → "2026-03-01T18:00:00"; date-only "20260301" → "2026-03-01".
function isoFromIcs(s: string | null): string | null {
  if (!s) return null;
  if (s.length < 8) return s;
  const date = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (s.length < 15 || s[8] !== "T") return date;
  return `${date}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}`;
}

function classifyOvernight(summary: string): EventType {
  const s = summary.toLowerCase();
  if (/summer camp|\bwente\b/.test(s)) return "summer_camp";
  if (/backpack|high adventure/.test(s)) return "backpacking";
  return "car_camping";
}

function heuristicGearType(row: CalendarEventRow): EventType | null {
  if (row.event_type === "overnight") return classifyOvernight(row.summary);
  return null;
}

// Same expression used in WHERE and ORDER BY — pulled out for legibility.
const ISO_DATE_EXPR = `substr(start_date,1,4)||'-'||substr(start_date,5,2)||'-'||substr(start_date,7,2)`;

async function loadUpcomingCalendarRows(events: D1Database): Promise<CalendarEventRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { results } = await events
    .prepare(
      `SELECT id, summary, start_date, end_date, event_type
         FROM calendar_events
        WHERE ${ISO_DATE_EXPR} >= ?
        ORDER BY start_date ASC
        LIMIT 100`,
    )
    .bind(today)
    .all<CalendarEventRow>();
  return results ?? [];
}

async function loadOverrides(
  db: D1Database,
  eventIds: string[],
): Promise<Map<string, EventType>> {
  if (!eventIds.length) return new Map();
  const placeholders = eventIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT event_id, gear_type FROM event_gear_types WHERE event_id IN (${placeholders})`)
    .bind(...eventIds)
    .all<{ event_id: string; gear_type: EventType }>();
  return new Map((results ?? []).map((r) => [r.event_id, r.gear_type]));
}

function toTroopEvent(row: CalendarEventRow, gear: EventType): TroopEvent | null {
  const start = isoFromIcs(row.start_date);
  if (!start) return null;
  return {
    id: String(row.id),
    name: row.summary,
    start_at: start,
    end_at: isoFromIcs(row.end_date),
    event_type: gear,
  };
}

// Scout-facing list: only events with an effective gear type (override or heuristic).
export async function listUpcoming(events: D1Database, db: D1Database): Promise<TroopEvent[]> {
  const rows = await loadUpcomingCalendarRows(events);
  const overrides = await loadOverrides(db, rows.map((r) => String(r.id)));
  const out: TroopEvent[] = [];
  for (const row of rows) {
    const id = String(row.id);
    const gear = overrides.get(id) ?? heuristicGearType(row);
    if (!gear) continue;
    const ev = toTroopEvent(row, gear);
    if (ev) out.push(ev);
  }
  return out.slice(0, 50);
}

// Leader "tag events" list: every upcoming calendar event (including untyped),
// with the effective gear type and a flag indicating whether it was set
// explicitly.
export async function listAllForLeader(
  events: D1Database,
  db: D1Database,
): Promise<LeaderEventRow[]> {
  const rows = await loadUpcomingCalendarRows(events);
  const overrides = await loadOverrides(db, rows.map((r) => String(r.id)));
  const out: LeaderEventRow[] = [];
  for (const row of rows) {
    const id = String(row.id);
    const start = isoFromIcs(row.start_date);
    if (!start) continue;
    const override = overrides.get(id);
    out.push({
      id,
      name: row.summary,
      start_at: start,
      end_at: isoFromIcs(row.end_date),
      calendar_type: row.event_type ?? "",
      gear_type: override ?? heuristicGearType(row),
      override_set: override !== undefined,
    });
  }
  return out;
}

export async function getEvent(
  events: D1Database,
  db: D1Database,
  id: string,
): Promise<TroopEvent | null> {
  const row = await events
    .prepare(
      `SELECT id, summary, start_date, end_date, event_type
         FROM calendar_events
        WHERE id = ?`,
    )
    .bind(id)
    .first<CalendarEventRow>();
  if (!row) return null;
  const override = await db
    .prepare(`SELECT gear_type FROM event_gear_types WHERE event_id = ?`)
    .bind(id)
    .first<{ gear_type: EventType }>();
  const gear = (override?.gear_type as EventType | undefined) ?? heuristicGearType(row);
  if (!gear) return null;
  return toTroopEvent(row, gear);
}

export async function setEventGearType(
  db: D1Database,
  eventId: string,
  gearType: EventType,
  setBy: string,
): Promise<void> {
  if (!EVENT_TYPES.includes(gearType)) throw new Error(`invalid gear_type: ${gearType}`);
  await db
    .prepare(
      `INSERT INTO event_gear_types (event_id, gear_type, set_by)
       VALUES (?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET
         gear_type = excluded.gear_type,
         set_by    = excluded.set_by,
         set_at    = datetime('now')`,
    )
    .bind(eventId, gearType, setBy)
    .run();
}

export async function clearEventGearType(db: D1Database, eventId: string): Promise<void> {
  await db.prepare(`DELETE FROM event_gear_types WHERE event_id = ?`).bind(eventId).run();
}

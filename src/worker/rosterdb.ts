import { LEADER_ROSTER_POSITIONS } from "../shared/types.ts";

// Read-only access to the externally-managed troop roster DB (ROSTER binding,
// imported from BSA). A member's role/position comes from their `positions`
// JSON array here, matched by email:
//   * adult_members.email  (scalar)
//   * youth_members.emails (JSON array — use json_each to match any entry)
// See migrations in the roster-db project for the full schema.

const LEADER_SET = new Set(
  LEADER_ROSTER_POSITIONS.map((p) => p.trim().toLowerCase()),
);

export function isLeaderRosterPosition(position: string): boolean {
  return LEADER_SET.has(position.trim().toLowerCase());
}

export function hasLeaderPosition(positions: string[]): boolean {
  return positions.some(isLeaderRosterPosition);
}

// Safely parse a `positions` JSON-array column into a string[].
function parsePositions(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

// All roster positions for one member (adult and/or youth records that match
// the email), merged and de-duplicated. Empty array if not found in the roster.
export async function getRosterPositions(
  roster: D1Database,
  email: string,
): Promise<string[]> {
  const e = email.trim().toLowerCase();
  if (!e) return [];
  const [adults, youth] = await Promise.all([
    roster
      .prepare(`SELECT positions FROM adult_members WHERE lower(email) = ?`)
      .bind(e)
      .all<{ positions: string }>(),
    roster
      .prepare(
        `SELECT ym.positions AS positions
           FROM youth_members ym, json_each(ym.emails) je
          WHERE lower(je.value) = ?`,
      )
      .bind(e)
      .all<{ positions: string }>(),
  ]);
  const all = [...(adults.results ?? []), ...(youth.results ?? [])]
    .flatMap((r) => parsePositions(r.positions));
  return dedupe(all);
}

// All known roster emails -> merged positions, for the roster overview. Keyed
// by lowercased email. Members with no email are skipped (they can't log in).
export async function getAllRosterPositions(
  roster: D1Database,
): Promise<Map<string, string[]>> {
  const [adults, youth] = await Promise.all([
    roster
      .prepare(
        `SELECT lower(email) AS email, positions
           FROM adult_members
          WHERE email IS NOT NULL AND trim(email) != ''`,
      )
      .all<{ email: string; positions: string }>(),
    roster
      .prepare(
        `SELECT lower(je.value) AS email, ym.positions AS positions
           FROM youth_members ym, json_each(ym.emails) je
          WHERE trim(je.value) != ''`,
      )
      .all<{ email: string; positions: string }>(),
  ]);
  const map = new Map<string, string[]>();
  for (const r of [...(adults.results ?? []), ...(youth.results ?? [])]) {
    const prev = map.get(r.email) ?? [];
    map.set(r.email, dedupe([...prev, ...parsePositions(r.positions)]));
  }
  return map;
}

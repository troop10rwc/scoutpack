import type { Position, Role, RosterMember, User } from "../shared/types.ts";
import { LEADER_POSITIONS, POSITIONS } from "../shared/types.ts";
import {
  getAllRosterNames,
  getAllRosterPositions,
  getRosterPositions,
  hasLeaderPosition,
} from "./rosterdb.ts";

// Role resolution. Three layers, highest precedence first:
//   1. Explicit override in member_roles (this DB) — see setPosition.
//   2. The member's positions in the external roster DB (BSA titles).
//   3. The Cloudflare Access LEADER_GROUP claim (bootstrap fallback) so the
//      troop is never locked out before the roster is wired up.
// See migrations/0005_member_roles.sql and src/worker/rosterdb.ts.

function overrideIsLeader(p: Position): boolean {
  // LEADER_POSITIONS is a narrow tuple from @troop10rwc/shared that excludes
  // "scout"; widen the readonly element type for the membership check.
  return (LEADER_POSITIONS as readonly Position[]).includes(p);
}

export function isValidPosition(p: unknown): p is Position {
  return typeof p === "string" && (POSITIONS as readonly string[]).includes(p);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Look up the explicit override for an email, if any.
export async function getOverride(
  db: D1Database,
  email: string,
): Promise<Position | null> {
  const row = await db
    .prepare(`SELECT position FROM member_roles WHERE email = ?`)
    .bind(normalizeEmail(email))
    .first<{ position: Position }>();
  return row?.position ?? null;
}

// Resolve the effective role from the three layers.
function resolveRole(
  override: Position | null,
  rosterPositions: string[],
  inLeaderGroup: boolean,
): Role {
  if (override) return overrideIsLeader(override) ? "leader" : "scout";
  if (hasLeaderPosition(rosterPositions)) return "leader";
  return inLeaderGroup ? "leader" : "scout";
}

// Combine the verified Access identity (`base` — the kit's Identity) with the
// override + roster DB to produce the app-level User. `inLeaderGroup` is the
// LEADER_GROUP membership from the Access JWT; it only matters as a last-resort
// fallback.
export async function resolveUser(
  db: D1Database,
  roster: D1Database,
  base: { email: string; name: string },
  inLeaderGroup: boolean,
): Promise<User> {
  const [override, rosterPositions] = await Promise.all([
    getOverride(db, base.email),
    getRosterPositions(roster, base.email),
  ]);
  return {
    email: base.email,
    name: base.name,
    role: resolveRole(override, rosterPositions, inLeaderGroup),
    override,
    rosterPositions,
  };
}

// Everyone the app knows about: logged-in accounts, members carrying an
// override, and members present in the roster DB — merged by email. Each row
// shows their roster-derived positions plus any override and the effective
// role. Leaders sort first, then alphabetically by email.
export async function listRoster(
  db: D1Database,
  roster: D1Database,
): Promise<RosterMember[]> {
  const [{ results }, rosterMap, nameMap] = await Promise.all([
    db
      .prepare(
        // member_roles emails are always lowercased; account emails come from
        // the JWT, so match case-insensitively to avoid duplicate rows.
        `SELECT LOWER(a.email) AS email, r.position AS override,
                r.updated_by AS updated_by, r.updated_at AS updated_at
           FROM accounts a
           LEFT JOIN member_roles r ON r.email = LOWER(a.email)
         UNION
         SELECT r.email AS email, r.position AS override,
                r.updated_by AS updated_by, r.updated_at AS updated_at
           FROM member_roles r
           WHERE r.email NOT IN (SELECT LOWER(email) FROM accounts)`,
      )
      .all<{
        email: string;
        override: Position | null;
        updated_by: string | null;
        updated_at: string | null;
      }>(),
    getAllRosterPositions(roster),
    getAllRosterNames(roster),
  ]);

  const byEmail = new Map<string, RosterMember>();
  for (const r of results ?? []) {
    const rosterPositions = rosterMap.get(r.email) ?? [];
    byEmail.set(r.email, {
      email: r.email,
      name: nameMap.get(r.email) ?? "",
      override: r.override,
      rosterPositions,
      role: resolveRole(r.override, rosterPositions, false),
      updated_by: r.updated_by,
      updated_at: r.updated_at,
    });
  }
  // Include roster members who have neither logged in nor have an override.
  for (const [email, rosterPositions] of rosterMap) {
    if (byEmail.has(email)) continue;
    byEmail.set(email, {
      email,
      name: nameMap.get(email) ?? "",
      override: null,
      rosterPositions,
      role: resolveRole(null, rosterPositions, false),
      updated_by: null,
      updated_at: null,
    });
  }

  // Leaders first, then by display name. Members without a roster name fall
  // back to their email so they still sort sensibly.
  return [...byEmail.values()].sort(
    (a, b) =>
      (a.role === "leader" ? 0 : 1) - (b.role === "leader" ? 0 : 1) ||
      (a.name || a.email).localeCompare(b.name || b.email),
  );
}

// Assign (upsert) a member's override. Passing null clears it, reverting them
// to roster-db / Access-group resolution.
export async function setOverride(
  db: D1Database,
  email: string,
  position: Position | null,
  editorEmail: string,
): Promise<void> {
  const normalized = normalizeEmail(email);
  if (position === null) {
    await db.prepare(`DELETE FROM member_roles WHERE email = ?`).bind(normalized).run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO member_roles (email, position, updated_by, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(email) DO UPDATE SET
         position = excluded.position,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    )
    .bind(normalized, position, normalizeEmail(editorEmail))
    .run();
}

// Gate for editing roles. Per configuration the editor set equals the leader
// set, so this currently mirrors requireLeader — kept distinct so the two
// capabilities can diverge later without touching call sites.
export function requireRoleManager(c: { get: (k: "user") => User }) {
  const u = c.get("user");
  if (u.role !== "leader") {
    const err = new Error("forbidden");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
}

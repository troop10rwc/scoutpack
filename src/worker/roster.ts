import type { Identity, Position, RosterMember, Role } from "../shared/types.ts";
import { LEADER_POSITIONS, POSITIONS } from "../shared/types.ts";

// Roster-driven role resolution. A member's role comes from an explicit
// position recorded in `member_roles`; if they have no row, the Cloudflare
// Access LEADER_GROUP claim is the fallback so the troop is never locked out
// before anyone has been assigned a position. See migrations/0005_member_roles.sql.

function isLeaderPosition(p: Position): boolean {
  return LEADER_POSITIONS.includes(p);
}

export function isValidPosition(p: unknown): p is Position {
  return typeof p === "string" && (POSITIONS as readonly string[]).includes(p);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Look up the explicit position for an email, if any.
export async function getPosition(
  db: D1Database,
  email: string,
): Promise<Position | null> {
  const row = await db
    .prepare(`SELECT position FROM member_roles WHERE email = ?`)
    .bind(normalizeEmail(email))
    .first<{ position: Position }>();
  return row?.position ?? null;
}

// Combine the verified Access identity with the roster to produce the final
// identity (role + position) the app reasons about. `inLeaderGroup` is the
// LEADER_GROUP membership derived from the Access JWT; it only matters when the
// member has no explicit position row.
export async function resolveIdentity(
  db: D1Database,
  base: { email: string; name: string },
  inLeaderGroup: boolean,
): Promise<Identity> {
  const position = await getPosition(db, base.email);
  let role: Role;
  if (position) {
    role = isLeaderPosition(position) ? "leader" : "scout";
  } else {
    role = inLeaderGroup ? "leader" : "scout";
  }
  return { email: base.email, name: base.name, role, position };
}

// Every known person: accounts that have logged in, plus any pre-assigned
// member_roles rows for people who haven't yet. Position-bearing members sort
// first (by seniority), then plain accounts alphabetically.
export async function listRoster(db: D1Database): Promise<RosterMember[]> {
  const { results } = await db
    .prepare(
      // member_roles emails are always lowercased; account emails come straight
      // from the JWT, so match case-insensitively to avoid splitting a member
      // into two rows.
      `SELECT LOWER(a.email) AS email, r.position AS position,
              r.updated_by AS updated_by, r.updated_at AS updated_at
         FROM accounts a
         LEFT JOIN member_roles r ON r.email = LOWER(a.email)
       UNION
       SELECT r.email AS email, r.position AS position,
              r.updated_by AS updated_by, r.updated_at AS updated_at
         FROM member_roles r
         WHERE r.email NOT IN (SELECT LOWER(email) FROM accounts)`,
    )
    .all<{
      email: string;
      position: Position | null;
      updated_by: string | null;
      updated_at: string | null;
    }>();
  const order = (p: Position | null) =>
    p ? POSITIONS.indexOf(p) : POSITIONS.length;
  return (results ?? [])
    .map((r) => ({
      email: r.email,
      position: r.position,
      role: (r.position && isLeaderPosition(r.position) ? "leader" : "scout") as Role,
      updated_by: r.updated_by,
      updated_at: r.updated_at,
    }))
    .sort((a, b) => order(a.position) - order(b.position) || a.email.localeCompare(b.email));
}

// Assign (upsert) a member's position. Passing null clears the explicit
// assignment, reverting them to the Access-group fallback (default scout).
export async function setPosition(
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
export function requireRoleManager(c: { get: (k: "user") => Identity }) {
  const u = c.get("user");
  if (u.role !== "leader") {
    const err = new Error("forbidden");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
}

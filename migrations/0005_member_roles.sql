-- Roster positions. Each member's effective role/capabilities are driven by an
-- explicit position recorded here rather than only by the Cloudflare Access
-- group claim.
--
-- Resolution (see src/worker/roster.ts):
--   * If a row exists for the member's email, its `position` wins — including an
--     explicit 'scout' row, which lets an admin demote someone who would
--     otherwise be a leader via the Access group.
--   * If no row exists, the Access LEADER_GROUP claim is the fallback so the
--     troop is never locked out before anyone has been assigned a position.
--
-- Keyed by email (not account id) so positions can be pre-assigned to people
-- who have not logged in yet — an account row is only created on first login.
CREATE TABLE member_roles (
  email      TEXT PRIMARY KEY,            -- lowercased Access identity email
  position   TEXT NOT NULL CHECK (position IN (
               'scoutmaster',
               'assistant_scoutmaster',
               'crew_advisor',
               'assistant_crew_advisor',
               'senior_patrol_leader',
               'scout')),
  updated_by TEXT NOT NULL,               -- email of the editor who set it
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

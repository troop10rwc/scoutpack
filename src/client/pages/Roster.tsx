import { useEffect, useState } from "react";
import { api } from "../api.ts";
import {
  POSITIONS,
  POSITION_LABELS,
  type Position,
  type RosterMember,
} from "../../shared/types.ts";

// Leader-only roster editor. Lists every known member and lets a role manager
// assign each one a position. Selecting "Scout (default)" clears the explicit
// assignment, reverting them to the Access-group fallback.
const NONE = "__none__";

export function Roster({ meEmail }: { meEmail: string }) {
  const [members, setMembers] = useState<RosterMember[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [savingEmail, setSavingEmail] = useState<string | null>(null);
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newPosition, setNewPosition] = useState<Position>("assistant_scoutmaster");

  useEffect(() => {
    api.listRoster()
      .then(setMembers)
      .catch((e: Error) => setErr(e.message));
  }, []);

  async function changePosition(email: string, value: string) {
    const position = value === NONE ? null : (value as Position);
    setErr(null);
    setSavedEmail(null);
    setSavingEmail(email);
    try {
      await api.setRosterPosition(email, position);
      setMembers((curr) =>
        (curr ?? []).map((m) =>
          m.email === email
            ? {
                ...m,
                position,
                role:
                  position && position !== "scout" ? "leader" : "scout",
                updated_by: meEmail,
                updated_at: new Date().toISOString(),
              }
            : m,
        ),
      );
      setSavedEmail(email);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingEmail(null);
    }
  }

  async function addMember() {
    const email = newEmail.trim().toLowerCase();
    if (!email.includes("@")) {
      setErr("Enter a valid email.");
      return;
    }
    setErr(null);
    try {
      await api.setRosterPosition(email, newPosition);
      setMembers((curr) => {
        const rest = (curr ?? []).filter((m) => m.email !== email);
        return [
          {
            email,
            position: newPosition,
            role: newPosition !== "scout" ? "leader" : "scout",
            updated_by: meEmail,
            updated_at: new Date().toISOString(),
          },
          ...rest,
        ];
      });
      setNewEmail("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (err && !members) return <div className="error">{err}</div>;
  if (!members) return <div className="loading">Loading…</div>;

  return (
    <div className="roster">
      <h1>Roster &amp; Roles</h1>
      <p className="hint">
        Scoutmasters, Assistant Scoutmasters, Crew Advisors, Assistant Crew
        Advisors, and the Senior Patrol Leader can edit roles. Anyone in those
        positions gets leader access to templates and event tagging.
      </p>

      <div className="roster-add row">
        <input
          type="email"
          placeholder="email to assign"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
        />
        <select
          value={newPosition}
          onChange={(e) => setNewPosition(e.target.value as Position)}
        >
          {POSITIONS.map((p) => (
            <option key={p} value={p}>{POSITION_LABELS[p]}</option>
          ))}
        </select>
        <button onClick={addMember}>Assign</button>
      </div>

      {err && <div className="error">{err}</div>}

      <table>
        <thead>
          <tr>
            <th>Member</th>
            <th>Position</th>
            <th>Access</th>
            <th>Last changed</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.email}>
              <td>{m.email}{m.email === meEmail && <span className="you"> (you)</span>}</td>
              <td>
                <select
                  value={m.position ?? NONE}
                  disabled={savingEmail === m.email}
                  onChange={(e) => changePosition(m.email, e.target.value)}
                >
                  <option value={NONE}>Scout — default</option>
                  {POSITIONS.filter((p) => p !== "scout").map((p) => (
                    <option key={p} value={p}>{POSITION_LABELS[p]}</option>
                  ))}
                  {/* Explicit scout overrides the Access-group fallback —
                      use this to demote someone who is in LEADER_GROUP. */}
                  <option value="scout">Scout — override group</option>
                </select>
                {savedEmail === m.email && <span className="saved"> Saved.</span>}
              </td>
              <td>
                {m.position === null
                  ? <span className="muted">Default (Access group)</span>
                  : m.role === "leader" ? "Leader" : "Scout"}
              </td>
              <td className="muted">
                {m.updated_by ? `${m.updated_by}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

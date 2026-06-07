import { useEffect, useState } from "react";
import { api } from "../api.ts";
import {
  POSITIONS,
  POSITION_LABELS,
  type Position,
  type RosterMember,
} from "../../shared/types.ts";

// Leader-only roster view. Roles come from the external roster DB (BSA
// positions, read-only). This page lets a role manager apply a manual
// OVERRIDE on top — useful for people not yet on the roster, or to grant/revoke
// access ahead of the next roster import. Selecting "No override" clears it and
// reverts the member to roster-db resolution.
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

  // Effective role after an override change. The client doesn't know the roster
  // leader-title set, so for "no override" on a member with roster positions we
  // keep the server-provided role (return undefined => caller keeps existing).
  function effectiveRole(
    override: Position | null,
    rosterPositions: string[],
  ): "leader" | "scout" | undefined {
    if (override) return override !== "scout" ? "leader" : "scout";
    return rosterPositions.length ? undefined : "scout";
  }

  async function changeOverride(member: RosterMember, value: string) {
    const override = value === NONE ? null : (value as Position);
    setErr(null);
    setSavedEmail(null);
    setSavingEmail(member.email);
    try {
      await api.setRosterOverride(member.email, override);
      setMembers((curr) =>
        (curr ?? []).map((m) =>
          m.email === member.email
            ? {
                ...m,
                override,
                role: effectiveRole(override, m.rosterPositions) ?? m.role,
                updated_by: meEmail,
                updated_at: new Date().toISOString(),
              }
            : m,
        ),
      );
      setSavedEmail(member.email);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingEmail(null);
    }
  }

  async function addOverride() {
    const email = newEmail.trim().toLowerCase();
    if (!email.includes("@")) {
      setErr("Enter a valid email.");
      return;
    }
    setErr(null);
    try {
      await api.setRosterOverride(email, newPosition);
      setMembers((curr) => {
        const existing = (curr ?? []).find((m) => m.email === email);
        const rest = (curr ?? []).filter((m) => m.email !== email);
        return [
          {
            email,
            override: newPosition,
            rosterPositions: existing?.rosterPositions ?? [],
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
        Roles come from the troop roster (read-only). Scoutmaster, Assistant
        Scoutmaster, Crew Advisor, Assistant Crew Advisor, Senior Patrol Leader,
        and Troop Admin get leader access to templates and event tagging. Use an{" "}
        <strong>override</strong> below to grant or revoke access for someone not
        (yet) on the roster — it takes precedence until cleared.
      </p>

      <div className="roster-add row">
        <input
          type="email"
          placeholder="email to override"
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
        <button onClick={addOverride}>Set override</button>
      </div>

      {err && <div className="error">{err}</div>}

      <table>
        <thead>
          <tr>
            <th>Member</th>
            <th>Roster positions</th>
            <th>Override</th>
            <th>Access</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.email}>
              <td>
                {m.email}
                {m.email === meEmail && <span className="you"> (you)</span>}
              </td>
              <td className="muted">
                {m.rosterPositions.length ? m.rosterPositions.join(", ") : "—"}
              </td>
              <td>
                <select
                  value={m.override ?? NONE}
                  disabled={savingEmail === m.email}
                  onChange={(e) => changeOverride(m, e.target.value)}
                >
                  <option value={NONE}>No override</option>
                  {POSITIONS.filter((p) => p !== "scout").map((p) => (
                    <option key={p} value={p}>{POSITION_LABELS[p]}</option>
                  ))}
                  {/* Force scout overrides a roster/group leader. */}
                  <option value="scout">Scout — revoke access</option>
                </select>
                {savedEmail === m.email && <span className="saved"> Saved.</span>}
              </td>
              <td>{m.role === "leader" ? "Leader" : "Scout"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

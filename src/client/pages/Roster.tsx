import { useEffect, useState } from "react";
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  StatusPill,
  Toolbar,
  ToolbarSpacer,
  statusCell,
  type Column,
} from "@troop10rwc/ui";
import { api } from "../api.ts";
import { usePageChrome } from "../chrome.tsx";
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
  const [newEmail, setNewEmail] = useState("");
  const [newPosition, setNewPosition] = useState<Position>("assistant_scoutmaster");

  const leaders = (members ?? []).filter((m) => m.role === "leader").length;
  usePageChrome(
    { title: "Roster & Roles", subtitle: `${members?.length ?? 0} members · ${leaders} leaders` },
    [members?.length, leaders],
  );

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

  async function changeOverride(email: string, value: string) {
    const member = (members ?? []).find((m) => m.email === email);
    if (!member) return;
    const override = value === NONE ? null : (value as Position);
    setErr(null);
    try {
      await api.setRosterOverride(email, override);
      setMembers((curr) =>
        (curr ?? []).map((m) =>
          m.email === email
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
    } catch (e) {
      setErr((e as Error).message);
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
            name: existing?.name ?? "",
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

  if (err && !members) return <EmptyState>{err}</EmptyState>;
  if (!members) return <EmptyState>Loading…</EmptyState>;

  const columns: Column<RosterMember>[] = [
    {
      key: "email",
      header: "Member",
      render: (m) => (
        <span className="sp-member">
          <span>
            {m.name || m.email}
            {m.email === meEmail && <span className="t10-sub"> (you)</span>}
          </span>
          {m.name && <span className="t10-sub sp-member__email">{m.email}</span>}
        </span>
      ),
    },
    {
      key: "rosterPositions",
      header: "Roster positions",
      render: (m) =>
        m.rosterPositions.length ? (
          m.rosterPositions.join(", ")
        ) : (
          <span className="t10-sub">—</span>
        ),
    },
    {
      key: "override",
      header: "Override",
      editor: "select",
      value: (m) => m.override ?? NONE,
      options: [
        { value: NONE, label: "No override" },
        ...POSITIONS.filter((p) => p !== "scout").map((p) => ({
          value: p,
          label: POSITION_LABELS[p],
        })),
        // Force scout overrides a roster/group leader.
        { value: "scout", label: "Scout — revoke access" },
      ],
      render: (m) =>
        m.override ? POSITION_LABELS[m.override] : <span className="t10-sub">none</span>,
    },
    {
      key: "role",
      header: "Access",
      render: (m) =>
        m.role === "leader" ? statusCell("Leader", "ok") : statusCell("Scout", "neutral"),
    },
  ];

  return (
    <div className="sp-page">
      <p className="t10-sub sp-hint">
        Roles come from the troop roster (read-only). Scoutmaster, Assistant
        Scoutmaster, Crew Advisor, Assistant Crew Advisor, Senior Patrol Leader,
        and Troop Admin get leader access. Use an <strong>override</strong> to grant
        or revoke access for someone not (yet) on the roster — it takes precedence
        until cleared.
      </p>

      <Toolbar>
        <Field label="Email to override">
          <input
            type="email"
            placeholder="name@example.org"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
        </Field>
        <Field label="Position">
          <select
            value={newPosition}
            onChange={(e) => setNewPosition(e.target.value as Position)}
          >
            {POSITIONS.map((p) => (
              <option key={p} value={p}>{POSITION_LABELS[p]}</option>
            ))}
          </select>
        </Field>
        <ToolbarSpacer />
        <Button variant="primary" onClick={addOverride}>Set override</Button>
      </Toolbar>

      {err && <p className="sp-error">{err}</p>}

      <DataTable
        rows={members}
        rowKey={(m) => m.email}
        canEdit
        onCellCommit={(email, _col, value) => changeOverride(email, String(value))}
        columns={columns}
        footer={
          <>
            <DataTable.Stat label="Members" value={members.length} />
            <DataTable.Stat label="Leaders" value={leaders} />
          </>
        }
      />
    </div>
  );
}

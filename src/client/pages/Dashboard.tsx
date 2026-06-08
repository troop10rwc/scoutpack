import { useEffect, useState } from "react";
import {
  Button,
  DataTable,
  EmptyState,
  SectionLabel,
  StatusPill,
  statusCell,
  type Column,
} from "@troop10rwc/ui";
import { api } from "../api.ts";
import { navigate } from "../router.ts";
import { usePageChrome } from "../chrome.tsx";
import { EVENT_TYPES, EVENT_TYPE_LABELS, type EventType } from "../../shared/constants.ts";
import type { LeaderEventRow, Me, Scout, UpcomingEvent } from "../../shared/types.ts";

export function Dashboard({ scout, me }: { scout: Scout; me: Me }) {
  const [events, setEvents] = useState<UpcomingEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  usePageChrome(
    {
      title: "Upcoming",
      subtitle: `${scout.display_name} · ${events?.length ?? 0} event${events?.length === 1 ? "" : "s"}`,
    },
    [scout.display_name, events?.length],
  );

  useEffect(() => {
    setEvents(null);
    api.upcomingEvents(scout.id)
      .then(setEvents)
      .catch((e: Error) => setErr(e.message));
  }, [scout.id]);

  async function generate(eventId: string) {
    try {
      await api.createPackingList(scout.id, eventId);
      navigate(`/event/${eventId}`);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (err) return <EmptyState>{err}</EmptyState>;
  if (!events) return <EmptyState>Loading events…</EmptyState>;

  return (
    <div className="sp-page">
      {!events.length && <EmptyState>No upcoming gear-relevant events.</EmptyState>}

      <div className="sp-events">
        {events.map((e) => (
          <div key={e.id} className="sp-event">
            <div className="sp-event__head">
              <a className="sp-event__name" href={`#/event/${encodeURIComponent(e.id)}`}>
                {e.name}
              </a>
              <StatusPill tone="neutral">{EVENT_TYPE_LABELS[e.event_type]}</StatusPill>
              <span className="t10-num sp-event__date">{formatDate(e.start_at)}</span>
            </div>
            {e.packing ? (
              <div className="sp-event__stats">
                <span><span className="t10-num">{e.packing.owned}/{e.packing.total}</span> owned</span>
                <span><span className="t10-num">{e.packing.packed}/{e.packing.total}</span> packed</span>
                {e.packing.owned < e.packing.total && (
                  <StatusPill tone="alert">{e.packing.total - e.packing.owned} missing</StatusPill>
                )}
              </div>
            ) : (
              <Button onClick={() => generate(e.id)}>Generate packing list</Button>
            )}
          </div>
        ))}
      </div>

      {me.role === "leader" && <LeaderTagger />}
    </div>
  );
}

function LeaderTagger() {
  const [rows, setRows] = useState<LeaderEventRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    setRows(null);
    api.allEventsForLeader().then(setRows).catch((e: Error) => setErr(e.message));
  }
  useEffect(load, []);

  async function set(eventId: string, value: string) {
    const gearType: EventType | null = value === "" ? null : (value as EventType);
    try {
      await api.setEventGearType(eventId, gearType);
      setRows((curr) =>
        (curr ?? []).map((r) =>
          r.id === eventId
            ? { ...r, gear_type: gearType, override_set: gearType !== null }
            : r,
        ),
      );
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (err) return <EmptyState>Leader tagger: {err}</EmptyState>;
  if (!rows) return null;

  const columns: Column<LeaderEventRow>[] = [
    {
      key: "start_at",
      header: "Date",
      render: (r) => <span className="t10-num">{formatDate(r.start_at)}</span>,
    },
    {
      key: "calendar_type",
      header: "Calendar type",
      render: (r) => <span className="t10-num">{r.calendar_type}</span>,
    },
    { key: "name", header: "Event" },
    {
      key: "gear_type",
      header: "Gear type",
      editor: "select",
      value: (r) => r.gear_type ?? "",
      options: [
        { value: "", label: "— untagged —" },
        ...EVENT_TYPES.map((t) => ({ value: t, label: EVENT_TYPE_LABELS[t] })),
      ],
      render: (r) => (r.gear_type ? EVENT_TYPE_LABELS[r.gear_type] : <span className="t10-sub">untagged</span>),
    },
    {
      key: "source",
      header: "Source",
      render: (r) =>
        r.override_set
          ? statusCell("Override", "info")
          : r.gear_type
            ? statusCell("Auto", "ok")
            : statusCell("—", "neutral"),
    },
  ];

  return (
    <section className="sp-section">
      <SectionLabel>Leader · tag upcoming events</SectionLabel>
      <p className="t10-sub sp-hint">
        Set the gear-list type for each upcoming event. Overrides take precedence
        over the summary-keyword guess. Clearing an override reverts to the guess
        (or removes the event from the scout view if no guess exists).
      </p>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        canEdit
        onCellCommit={(id, _col, value) => set(id, String(value))}
        columns={columns}
        footer={<DataTable.Stat label="Events" value={rows.length} />}
      />
    </section>
  );
}

function formatDate(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

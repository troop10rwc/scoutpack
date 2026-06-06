import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { navigate } from "../router.ts";
import { EVENT_TYPES, EVENT_TYPE_LABELS, type EventType } from "../../shared/constants.ts";
import type { LeaderEventRow, Me, Scout, UpcomingEvent } from "../../shared/types.ts";

export function Dashboard({ scout, me }: { scout: Scout; me: Me }) {
  const [events, setEvents] = useState<UpcomingEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

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

  if (err) return <div className="error">{err}</div>;
  if (!events) return <div className="loading">Loading events…</div>;

  return (
    <div className="events">
      <h1>Upcoming events for {scout.display_name}</h1>
      {!events.length && <div className="empty">No upcoming gear-relevant events.</div>}
      <ul className="event-list">
        {events.map((e) => (
          <li key={e.id} className="event-card">
            <div className="event-meta">
              <span className={`type-badge type-${e.event_type}`}>
                {EVENT_TYPE_LABELS[e.event_type]}
              </span>
              <span className="event-date">{formatDate(e.start_at)}</span>
            </div>
            <a className="event-name" href={`#/event/${encodeURIComponent(e.id)}`}>
              {e.name}
            </a>
            {e.packing ? (
              <div className="event-stats">
                <span>{e.packing.owned}/{e.packing.total} owned</span>
                <span>{e.packing.packed}/{e.packing.total} packed</span>
                {e.packing.owned < e.packing.total && (
                  <span className="missing">
                    {e.packing.total - e.packing.owned} missing
                  </span>
                )}
              </div>
            ) : (
              <button onClick={() => generate(e.id)}>Generate packing list</button>
            )}
          </li>
        ))}
      </ul>

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

  if (err) return <div className="error">Leader tagger: {err}</div>;
  if (!rows) return null;

  return (
    <section className="leader-tagger">
      <h2>Leader: tag upcoming events</h2>
      <p className="muted">
        Set the gear-list type for each upcoming event. Overrides take
        precedence over the summary-keyword guess. Clearing an override
        reverts to the guess (or removes the event from the scout view if no
        guess exists).
      </p>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Calendar type</th>
            <th>Event</th>
            <th>Gear type</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{formatDate(r.start_at)}</td>
              <td><code>{r.calendar_type}</code></td>
              <td>{r.name}</td>
              <td>
                <select
                  value={r.gear_type ?? ""}
                  onChange={(e) => set(r.id, e.target.value)}
                >
                  <option value="">— untagged —</option>
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </td>
              <td>
                {r.override_set ? "override" : r.gear_type ? "auto" : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

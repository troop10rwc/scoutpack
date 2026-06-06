import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { EVENT_TYPE_LABELS } from "../../shared/constants.ts";
import type { PackingListBundle, Scout } from "../../shared/types.ts";

type BundleOrEmpty =
  | PackingListBundle
  | { list: null; event: PackingListBundle["event"]; items: [] };

export function EventDetail({ scout, eventId }: { scout: Scout; eventId: string }) {
  const [bundle, setBundle] = useState<BundleOrEmpty | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    setBundle(null);
    api.getPackingList(scout.id, eventId)
      .then(setBundle)
      .catch((e: Error) => setErr(e.message));
  }
  useEffect(load, [scout.id, eventId]);

  async function generate() {
    try {
      const b = await api.createPackingList(scout.id, eventId);
      setBundle(b);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function togglePacked(itemId: string, packed: boolean) {
    await api.updatePackingListItem(scout.id, itemId, { packed });
    setBundle((b) =>
      b && b.list
        ? { ...b, items: b.items.map((it) => it.id === itemId ? { ...it, packed: packed ? 1 : 0 } : it) }
        : b,
    );
  }

  async function addMissingToCloset(item: PackingListBundle["items"][number]) {
    const created = await api.createClosetItem(scout.id, {
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      is_worn: item.is_worn,
      is_consumable: item.is_consumable,
    });
    // Server auto-links matching pending packing-list items on create.
    setBundle((b) =>
      b && b.list
        ? {
            ...b,
            items: b.items.map((it) =>
              it.id === item.id
                ? { ...it, closet_item_id: created.id, owned: true, closet_item: created }
                : it,
            ),
          }
        : b,
    );
  }

  if (err) return <div className="error">{err}</div>;
  if (!bundle) return <div className="loading">Loading…</div>;

  const { event } = bundle;
  if (!bundle.list) {
    return (
      <div className="event-detail">
        <EventHeader event={event} />
        <p>No packing list yet for this event.</p>
        <button onClick={generate}>Generate from {EVENT_TYPE_LABELS[event.event_type]} template</button>
      </div>
    );
  }

  const total = bundle.items.length;
  const owned = bundle.items.filter((i) => i.owned).length;
  const packed = bundle.items.filter((i) => i.packed).length;
  const byCategory = new Map<string, typeof bundle.items>();
  for (const it of bundle.items) {
    const arr = byCategory.get(it.category) ?? [];
    arr.push(it);
    byCategory.set(it.category, arr);
  }

  return (
    <div className="event-detail">
      <EventHeader event={event} />
      <div className="stats">
        <span>{owned}/{total} owned</span>
        <span>{packed}/{total} packed</span>
        {owned < total && (
          <span className="missing">{total - owned} missing from closet</span>
        )}
      </div>

      {[...byCategory.entries()].map(([cat, list]) => (
        <section key={cat} className="category">
          <h2>{cat}</h2>
          <ul className="packing-list">
            {list.map((it) => (
              <li key={it.id} className={it.owned ? "" : "missing-row"}>
                <label className="packed-toggle">
                  <input
                    type="checkbox"
                    checked={!!it.packed}
                    disabled={!it.owned}
                    onChange={(e) => togglePacked(it.id, e.target.checked)}
                  />
                </label>
                <span className="item-name">
                  {it.name}
                  {it.quantity > 1 && <small> × {it.quantity}</small>}
                </span>
                {it.is_worn ? <span className="tag">worn</span> : null}
                {it.is_consumable ? <span className="tag">consumable</span> : null}
                {!it.owned && (
                  <>
                    <span className="badge missing">Not in closet</span>
                    <button onClick={() => addMissingToCloset(it)}>Add to closet</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function EventHeader({ event }: { event: PackingListBundle["event"] }) {
  return (
    <header className="event-header">
      <h1>{event.name}</h1>
      <div>
        <span className={`type-badge type-${event.event_type}`}>
          {EVENT_TYPE_LABELS[event.event_type]}
        </span>
        <span>{new Date(event.start_at).toLocaleDateString()}</span>
      </div>
    </header>
  );
}

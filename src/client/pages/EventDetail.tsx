import { useEffect, useState } from "react";
import { Button, EmptyState, SectionLabel, StatusPill } from "@troop10rwc/ui";
import { api } from "../api.ts";
import { usePageChrome } from "../chrome.tsx";
import { EVENT_TYPE_LABELS } from "../../shared/constants.ts";
import type { PackingListBundle, Scout } from "../../shared/types.ts";

type BundleOrEmpty =
  | PackingListBundle
  | { list: null; event: PackingListBundle["event"]; items: [] };

export function EventDetail({ scout, eventId }: { scout: Scout; eventId: string }) {
  const [bundle, setBundle] = useState<BundleOrEmpty | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const ev = bundle?.event ?? null;
  usePageChrome(
    {
      title: ev?.name ?? "Packing List",
      subtitle: ev ? `${EVENT_TYPE_LABELS[ev.event_type]} · ${formatDate(ev.start_at)}` : undefined,
    },
    [ev?.name, ev?.event_type, ev?.start_at],
  );

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

  if (err) return <EmptyState>{err}</EmptyState>;
  if (!bundle) return <EmptyState>Loading…</EmptyState>;

  const { event } = bundle;
  if (!bundle.list) {
    return (
      <div className="sp-page">
        <EmptyState>No packing list yet for this event.</EmptyState>
        <div style={{ textAlign: "center" }}>
          <Button variant="primary" onClick={generate}>
            Generate from {EVENT_TYPE_LABELS[event.event_type]} template
          </Button>
        </div>
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
    <div className="sp-page">
      <div className="sp-stats">
        <span><span className="t10-num">{owned}/{total}</span> owned</span>
        <span><span className="t10-num">{packed}/{total}</span> packed</span>
        {owned < total && <StatusPill tone="alert">{total - owned} missing from closet</StatusPill>}
      </div>

      {[...byCategory.entries()].map(([cat, list]) => (
        <section key={cat} className="sp-section">
          <SectionLabel>{cat}</SectionLabel>
          <ul className="sp-packing">
            {list.map((it) => (
              <li key={it.id} className={it.owned ? "" : "is-missing"}>
                <input
                  type="checkbox"
                  className="sp-packing__check"
                  checked={!!it.packed}
                  disabled={!it.owned}
                  aria-label={`Packed: ${it.name}`}
                  onChange={(e) => togglePacked(it.id, e.target.checked)}
                />
                <span className="sp-packing__name">
                  {it.name}
                  {it.quantity > 1 && <span className="t10-num sp-packing__qty"> ×{it.quantity}</span>}
                </span>
                {it.is_worn ? <StatusPill tone="neutral">worn</StatusPill> : null}
                {it.is_consumable ? <StatusPill tone="neutral">consumable</StatusPill> : null}
                {!it.owned && (
                  <>
                    <StatusPill tone="alert">Not in closet</StatusPill>
                    <Button size="sm" onClick={() => addMissingToCloset(it)}>Add to closet</Button>
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

import { useEffect, useState } from "react";
import { Button, EmptyState, StatusPill } from "@troop10rwc/ui";
import { api } from "../api.ts";
import { usePageChrome } from "../chrome.tsx";
import { Icon, NameInput, useTemplateSuggestions, type NameSuggestion } from "../components/gear.tsx";
import { EVENT_TYPE_LABELS } from "../../shared/constants.ts";
import type { PackingItemView, PackingListBundle, Scout } from "../../shared/types.ts";

type BundleOrEmpty =
  | PackingListBundle
  | { list: null; event: PackingListBundle["event"]; items: [] };

// Per-item weight comes from the linked closet gear (the packing item carries no
// weight of its own); unlinked/"missing" items contribute nothing.
const weightOf = (it: PackingItemView) =>
  (it.closet_item?.weight_grams ?? 0) * it.quantity;
const fmtKg = (grams: number) => `${(grams / 1000).toFixed(2)} kg`;

export function EventDetail({ scout, eventId }: { scout: Scout; eventId: string }) {
  const [bundle, setBundle] = useState<BundleOrEmpty | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const suggestions = useTemplateSuggestions();
  // Categories added via "Add new category" that hold no items yet.
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
  const [newCat, setNewCat] = useState("");
  // Id of a just-added item whose name field should auto-focus for filling in.
  const [focusId, setFocusId] = useState<string | null>(null);

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
  // Drop transient add-category state when switching events.
  useEffect(() => {
    setExtraCategories([]);
    setNewCat("");
  }, [eventId]);

  // --- item mutations (operate on the loaded bundle's items) ---
  function setItems(fn: (items: PackingItemView[]) => PackingItemView[]) {
    setBundle((b) => (b && b.list ? { ...b, items: fn(b.items) } : b));
  }
  function editLocal(id: string, fields: Partial<PackingItemView>) {
    setItems((items) => items.map((it) => (it.id === id ? { ...it, ...fields } : it)));
  }
  function patch(id: string, fields: Parameters<typeof api.updatePackingListItem>[2]) {
    api
      .updatePackingListItem(scout.id, id, fields)
      .then((updated) => setItems((items) => items.map((it) => (it.id === id ? updated : it))))
      .catch((e: Error) => setErr(e.message));
  }

  async function generate() {
    try {
      const b = await api.createPackingList(scout.id, eventId);
      setBundle(b);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function addItemTo(category: string) {
    if (!bundle?.list) return;
    try {
      const created = await api.addPackingListItem(scout.id, {
        packing_list_id: bundle.list.id,
        name: "New item",
        category,
        quantity: 1,
      });
      setItems((items) => [...items, created]);
      setFocusId(created.id);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function addCategory(existing: string[]) {
    const c = newCat.trim();
    if (!c) return;
    if (!existing.includes(c)) setExtraCategories((x) => [...x, c]);
    setNewCat("");
  }

  async function remove(id: string) {
    if (!confirm("Remove this item from the packing list?")) return;
    try {
      await api.deletePackingListItem(scout.id, id);
      setItems((items) => items.filter((it) => it.id !== id));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  // Create a closet item from a "missing" packing item. The server auto-links
  // matching pending packing items on create, so reflect ownership locally.
  async function addToCloset(item: PackingItemView) {
    try {
      const created = await api.createClosetItem(scout.id, {
        name: item.name,
        category: item.category,
        quantity: item.quantity,
        is_worn: item.is_worn,
        is_consumable: item.is_consumable,
      });
      setItems((items) =>
        items.map((it) =>
          it.id === item.id
            ? { ...it, closet_item_id: created.id, owned: true, closet_item: created }
            : it,
        ),
      );
    } catch (e) {
      setErr((e as Error).message);
    }
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

  const items = bundle.items;
  const total = items.length;
  const owned = items.filter((i) => i.owned).length;
  const packed = items.filter((i) => i.packed).length;
  const totalWeight = items.reduce((a, it) => a + weightOf(it), 0);

  const byCategory = new Map<string, PackingItemView[]>();
  for (const it of items) {
    const arr = byCategory.get(it.category) ?? [];
    arr.push(it);
    byCategory.set(it.category, arr);
  }
  const itemCats = [...byCategory.keys()];
  const renderCats = [...new Set([...itemCats, ...extraCategories])].sort((a, b) =>
    a.localeCompare(b),
  );

  return (
    <div className="sp-page sp-closet">
      <div className="sp-stats">
        <span><span className="t10-num">{owned}/{total}</span> owned</span>
        <span><span className="t10-num">{packed}/{total}</span> packed</span>
        <span><span className="t10-num">{fmtKg(totalWeight)}</span> owned gear</span>
        {owned < total && <StatusPill tone="alert">{total - owned} missing from closet</StatusPill>}
      </div>

      {renderCats.map((cat) => {
        const list = byCategory.get(cat) ?? [];
        const subtotal = list.reduce((a, it) => a + weightOf(it), 0);
        const count = list.reduce((a, it) => a + it.quantity, 0);
        return (
          <section key={cat} className="sp-cat">
            <h2 className="sp-cat__head">{cat}</h2>
            <div className="sp-gearwrap">
              <table className="sp-gear">
                <thead>
                  <tr>
                    <th className="sp-gear__check" title="Packed">✓</th>
                    <th className="sp-gear__name">Item</th>
                    <th>Description</th>
                    <th></th>
                    <th className="is-right">Weight</th>
                    <th className="is-right">Qty</th>
                    <th className="sp-gear__del"></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((it) => (
                    <PackRow
                      key={it.id}
                      item={it}
                      suggestions={suggestions}
                      autoFocusName={focusId === it.id}
                      onTogglePacked={(p) => patch(it.id, { packed: p })}
                      onEditLocal={(f) => editLocal(it.id, f)}
                      onPatch={(f) => patch(it.id, f)}
                      onAddToCloset={() => addToCloset(it)}
                      onRemove={() => remove(it.id)}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}></td>
                    <td className="is-right t10-num">{fmtKg(subtotal)}</td>
                    <td className="is-right t10-num">{count}</td>
                    <td className="sp-gear__del"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="sp-addmore">
              <Button size="sm" variant="ghost" onClick={() => addItemTo(cat)}>
                + Add new item
              </Button>
            </div>
          </section>
        );
      })}

      <div className="sp-addcat">
        <input
          className="sp-cell"
          placeholder="New category name"
          value={newCat}
          onChange={(e) => setNewCat(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addCategory(renderCats)}
        />
        <Button onClick={() => addCategory(renderCats)} disabled={!newCat.trim()}>
          + Add new category
        </Button>
      </div>
    </div>
  );
}

function PackRow({
  item,
  suggestions,
  autoFocusName,
  onTogglePacked,
  onEditLocal,
  onPatch,
  onAddToCloset,
  onRemove,
}: {
  item: PackingItemView;
  suggestions: NameSuggestion[];
  autoFocusName: boolean;
  onTogglePacked: (packed: boolean) => void;
  onEditLocal: (f: Partial<PackingItemView>) => void;
  onPatch: (f: Parameters<typeof api.updatePackingListItem>[2]) => void;
  onAddToCloset: () => void;
  onRemove: () => void;
}) {
  const weight = item.closet_item?.weight_grams ?? null;
  return (
    <tr className={item.owned ? "" : "is-missing"}>
      <td className="sp-gear__check">
        <input
          type="checkbox"
          checked={!!item.packed}
          disabled={!item.owned}
          aria-label={`Packed: ${item.name}`}
          title={item.owned ? "Packed" : "Add to your closet to pack"}
          onChange={(e) => onTogglePacked(e.target.checked)}
        />
      </td>
      <td>
        <NameInput
          value={item.name}
          suggestions={suggestions}
          autoFocus={autoFocusName}
          onChange={(v) => onEditLocal({ name: v })}
          onCommit={(v) => onPatch({ name: v.trim() || item.name })}
        />
      </td>
      <td>
        <input
          className="sp-cell sp-cell--soft"
          placeholder="description"
          value={item.description ?? ""}
          onChange={(e) => onEditLocal({ description: e.target.value })}
          onBlur={(e) => onPatch({ description: e.target.value || null })}
        />
      </td>
      <td className="sp-gear__acts">
        <button
          className={`sp-iconbtn${item.is_worn ? " is-on" : ""}`}
          onClick={() => onPatch({ is_worn: !item.is_worn })}
          title="Worn"
        >
          <Icon name="shirt" />
        </button>
        <button
          className={`sp-iconbtn${item.is_consumable ? " is-on" : ""}`}
          onClick={() => onPatch({ is_consumable: !item.is_consumable })}
          title="Consumable"
        >
          <Icon name="utensils" />
        </button>
        {item.owned ? (
          <StatusPill tone="ok">in closet</StatusPill>
        ) : (
          <>
            <StatusPill tone="alert">missing</StatusPill>
            <Button size="sm" onClick={onAddToCloset}>Add to closet</Button>
          </>
        )}
      </td>
      <td className="is-right sp-gear__weight">
        {weight != null ? (
          <>
            <span className="t10-num">{weight}</span>
            <span className="sp-unit-suffix">g</span>
          </>
        ) : (
          <span className="t10-sub">—</span>
        )}
      </td>
      <td className="is-right">
        <input
          className="sp-cell t10-num sp-gear__qty"
          type="number"
          min={1}
          value={item.quantity}
          onChange={(e) => onEditLocal({ quantity: Number(e.target.value) || 1 })}
          onBlur={(e) => onPatch({ quantity: Number(e.target.value) || 1 })}
        />
      </td>
      <td className="sp-gear__del">
        <button className="sp-iconbtn sp-iconbtn--del" onClick={onRemove} title="Remove item">×</button>
      </td>
    </tr>
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

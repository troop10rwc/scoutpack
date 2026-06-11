import { useEffect, useState } from "react";
import { Button, EmptyState, SearchInput, StatusPill } from "@troop10rwc/ui";
import { api } from "../api.ts";
import { usePageChrome } from "../chrome.tsx";
import { Icon, NameInput, useTemplateSuggestions, type NameSuggestion } from "../components/gear.tsx";
import { EVENT_TYPE_LABELS } from "../../shared/constants.ts";
import type { ClosetItem, PackingItemView, PackingListBundle, Scout } from "../../shared/types.ts";

type BundleOrEmpty =
  | PackingListBundle
  | { list: null; event: PackingListBundle["event"]; items: [] };

// Per-item weight comes from the linked closet gear (the packing item carries no
// weight of its own); unlinked/"missing" items contribute nothing.
const weightOf = (it: PackingItemView) =>
  (it.closet_item?.weight_grams ?? 0) * it.quantity;
const fmtKg = (grams: number) => `${(grams / 1000).toFixed(2)} kg`;
// Quantities are small — clamp to 1–99 so the column stays two digits wide.
const clampQty = (v: string | number) => Math.min(99, Math.max(1, Math.floor(Number(v)) || 1));

export function EventDetail({ scout, eventId }: { scout: Scout; eventId: string }) {
  const [bundle, setBundle] = useState<BundleOrEmpty | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const suggestions = useTemplateSuggestions();
  // Categories added via "Add new category" that hold no items yet.
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
  const [newCat, setNewCat] = useState("");
  // Id of a just-added item whose name field should auto-focus for filling in.
  const [focusId, setFocusId] = useState<string | null>(null);
  // Drag-reorder state (mirrors the closet ledger).
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // The scout's closet, shown as a drag-and-drop palette in the sidebar.
  const [closet, setCloset] = useState<ClosetItem[] | null>(null);
  // Id of the closet item currently being dragged from the gear sidebar.
  const [gearDragId, setGearDragId] = useState<string | null>(null);

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
  // The closet palette is per-scout (independent of the event), so load it once
  // per scout and reuse across events.
  useEffect(() => {
    setCloset(null);
    api.listCloset(scout.id).then(setCloset).catch(() => setCloset([]));
  }, [scout.id]);
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

  // --- drag reorder (within + across categories), mirroring the closet ---
  function persistOrder(list: PackingItemView[]) {
    api
      .reorderPacking(
        scout.id,
        list.map((i) => ({ id: i.id, category: i.category, sort_order: i.sort_order })),
      )
      .catch((e: Error) => setErr(e.message));
  }
  function dropOn(targetCategory: string, beforeId: string | null) {
    const id = dragId;
    setDragId(null);
    setDragOverId(null);
    if (!id) return;
    setItems((prev) => {
      const drag = prev.find((i) => i.id === id);
      if (!drag) return prev;
      const without = prev.filter((i) => i.id !== id);
      const moved: PackingItemView = { ...drag, category: targetCategory };
      let at: number;
      if (beforeId) {
        at = without.findIndex((i) => i.id === beforeId);
        if (at < 0) at = without.length;
      } else {
        // Append after the last item already in the target category.
        let last = -1;
        without.forEach((i, idx) => {
          if (i.category === targetCategory) last = idx;
        });
        at = last === -1 ? without.length : last + 1;
      }
      const next = [...without.slice(0, at), moved, ...without.slice(at)];
      // Re-number sort_order within each category to match the new arrangement.
      const counter = new Map<string, number>();
      const renumbered = next.map((it) => {
        const n = counter.get(it.category) ?? 0;
        counter.set(it.category, n + 1);
        return it.sort_order === n ? it : { ...it, sort_order: n };
      });
      persistOrder(renumbered);
      return renumbered;
    });
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

  // Link a "missing" packing item to an existing closet item dragged in from the
  // gear sidebar. The server resolves ownership + weight; patch reflects it. The
  // linked gear then drops out of the palette (it's filtered by closet_item_id).
  function linkGear(packingItemId: string) {
    const closetItemId = gearDragId;
    setGearDragId(null);
    if (!closetItemId) return;
    patch(packingItemId, { closet_item_id: closetItemId });
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

  // Closet gear not yet linked to a row on this list — the palette of items you
  // can drag onto the "missing" rows. Shrinks as you assign gear.
  const linkedIds = new Set(items.map((i) => i.closet_item_id).filter((x): x is string => !!x));
  const availableGear = (closet ?? []).filter((c) => !linkedIds.has(c.id));
  const hasMissing = owned < total;

  return (
    <div className="sp-eventlayout">
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
          <section
            key={cat}
            className="sp-cat"
            onDragOver={(e) => dragId && e.preventDefault()}
            onDrop={() => dragId && dropOn(cat, null)}
          >
            <h2 className="sp-cat__head">{cat}</h2>
            <div className="sp-gearwrap">
              <table className="sp-gear">
                <thead>
                  <tr>
                    <th className="sp-gear__grip"></th>
                    <th className="sp-gear__check" title="Packed">✓</th>
                    <th className="sp-gear__name">Item</th>
                    <th className="sp-gear__desc">Description</th>
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
                      dragOver={dragOverId === it.id}
                      gearTarget={!it.owned && gearDragId !== null}
                      onGearDrop={() => linkGear(it.id)}
                      onDragStart={() => setDragId(it.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setDragOverId(null);
                      }}
                      onDragEnter={() => dragId && dragId !== it.id && setDragOverId(it.id)}
                      onDropRow={(e) => {
                        e.stopPropagation();
                        dropOn(it.category, it.id);
                      }}
                      onTogglePacked={(p) => patch(it.id, { packed: p })}
                      onEditLocal={(f) => editLocal(it.id, f)}
                      onPatch={(f) => patch(it.id, f)}
                      onRemove={() => remove(it.id)}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}></td>
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

      <GearSidebar
        loading={closet === null}
        gear={availableGear}
        hasMissing={hasMissing}
        onDragStart={setGearDragId}
        onDragEnd={() => setGearDragId(null)}
      />
    </div>
  );
}

// The closet-as-palette sidebar shown next to a packing list: every closet item
// not yet linked to this list, draggable onto a "missing" row to claim it.
function GearSidebar({
  loading,
  gear,
  hasMissing,
  onDragStart,
  onDragEnd,
}: {
  loading: boolean;
  gear: ClosetItem[];
  hasMissing: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? gear.filter(
        (g) => g.name.toLowerCase().includes(q) || g.category.toLowerCase().includes(q),
      )
    : gear;

  const byCategory = new Map<string, ClosetItem[]>();
  for (const it of filtered) {
    const arr = byCategory.get(it.category) ?? [];
    arr.push(it);
    byCategory.set(it.category, arr);
  }
  const cats = [...byCategory.keys()].sort((a, b) => a.localeCompare(b));

  return (
    <aside className="sp-gearbar" aria-label="Closet gear">
      <h2 className="sp-gearbar__head">Closet</h2>
      {!loading && gear.length > 0 && (
        <div className="sp-gearbar__search">
          <SearchInput
            placeholder="Search gear…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search closet gear"
          />
        </div>
      )}
      <p className="t10-sub sp-gearbar__hint">
        {hasMissing
          ? "Drag gear onto a missing item to claim it."
          : "Every item on this list is claimed."}
      </p>
      {loading ? (
        <p className="t10-sub">Loading…</p>
      ) : gear.length === 0 ? (
        <p className="t10-sub">No unassigned closet gear.</p>
      ) : filtered.length === 0 ? (
        <p className="t10-sub">No gear matches “{query.trim()}”.</p>
      ) : (
        cats.map((cat) => (
          <div key={cat} className="sp-gearbar__cat">
            <h3 className="sp-gearbar__catname">{cat}</h3>
            <ul className="sp-gearchips">
              {(byCategory.get(cat) ?? []).map((it) => (
                <li
                  key={it.id}
                  className="sp-gearchip"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "link";
                    onDragStart(it.id);
                  }}
                  onDragEnd={onDragEnd}
                  title={`Drag “${it.name}” onto a missing item${
                    it.weight_grams != null ? ` · ${it.weight_grams} g` : ""
                  }`}
                >
                  <span className="sp-gearchip__grip" aria-hidden="true">⠿</span>
                  <span className="sp-gearchip__name">{it.name}</span>
                  {it.weight_grams != null && (
                    <span className="sp-gearchip__w t10-num">{it.weight_grams}g</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </aside>
  );
}

// A small link badge marking a packing row as filled by closet gear. It both
// signals the link and, on click, detaches it (the gear returns to the palette).
function UnlinkButton({ name, onUnlink }: { name: string; onUnlink: () => void }) {
  return (
    <button
      type="button"
      className="sp-linkbadge"
      onClick={onUnlink}
      title={`Linked to “${name}” — click to unlink`}
      aria-label={`Linked to ${name}. Click to unlink.`}
    >
      <Icon name="link" />
    </button>
  );
}

function PackRow({
  item,
  suggestions,
  autoFocusName,
  dragOver,
  gearTarget,
  onGearDrop,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDropRow,
  onTogglePacked,
  onEditLocal,
  onPatch,
  onRemove,
}: {
  item: PackingItemView;
  suggestions: NameSuggestion[];
  autoFocusName: boolean;
  dragOver: boolean;
  // True while closet gear is being dragged and this row is a valid (missing) target.
  gearTarget: boolean;
  onGearDrop: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragEnter: () => void;
  onDropRow: (e: React.DragEvent) => void;
  onTogglePacked: (packed: boolean) => void;
  onEditLocal: (f: Partial<PackingItemView>) => void;
  onPatch: (f: Parameters<typeof api.updatePackingListItem>[2]) => void;
  onRemove: () => void;
}) {
  const weight = item.closet_item?.weight_grams ?? null;
  // When a row is filled by closet gear whose name differs from the template
  // requirement, the gear name leads (it's what you're actually packing) and the
  // requirement it satisfies drops to a caption.
  const linkedGear =
    item.closet_item && item.closet_item.match_key !== item.match_key ? item.closet_item : null;
  const nameInput = (
    <NameInput
      value={item.name}
      suggestions={suggestions}
      autoFocus={autoFocusName}
      onChange={(v) => onEditLocal({ name: v })}
      onCommit={(v) => onPatch({ name: v.trim() || item.name })}
    />
  );
  return (
    <tr
      className={`${item.owned ? "" : "is-missing"}${dragOver ? " is-dragover" : ""}${gearTarget ? " is-geartarget" : ""}`}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={onDragEnter}
      onDrop={
        gearTarget
          ? (e) => {
              e.stopPropagation();
              onGearDrop();
            }
          : onDropRow
      }
    >
      <td className="sp-gear__grip">
        <span
          className="sp-grip"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          title="Drag to reorder"
        >
          ⠿
        </span>
      </td>
      <td className="sp-gear__check">
        <input
          type="checkbox"
          checked={!!item.packed}
          disabled={!item.owned}
          aria-label={`Packed: ${item.name}`}
          title={item.owned ? "Packed" : "Drag gear from the closet to pack this"}
          onChange={(e) => onTogglePacked(e.target.checked)}
        />
      </td>
      <td>
        {linkedGear ? (
          <div className="sp-packname">
            <span className="sp-packname__main">
              <UnlinkButton name={linkedGear.name} onUnlink={() => onPatch({ closet_item_id: null })} />
              {linkedGear.name}
            </span>
            <span className="sp-packname__req" title={`Packed for the “${item.name}” item`}>
              for {item.name}
            </span>
          </div>
        ) : item.closet_item ? (
          // Same-name link (auto-matched or dropped onto an identical name): keep
          // the editable name, flagged with a link badge that also unlinks.
          <div className="sp-packlinked">
            <UnlinkButton name={item.closet_item.name} onUnlink={() => onPatch({ closet_item_id: null })} />
            {nameInput}
          </div>
        ) : (
          nameInput
        )}
      </td>
      <td className="sp-gear__desc">
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
          max={99}
          value={item.quantity}
          onChange={(e) => onEditLocal({ quantity: clampQty(e.target.value) })}
          onBlur={(e) => onPatch({ quantity: clampQty(e.target.value) })}
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

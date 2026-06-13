import { useEffect, useState } from "react";
import { Button, EmptyState, SearchInput, StatusPill } from "@troop10rwc/ui";
import { api } from "../api.ts";
import { usePageChrome } from "../chrome.tsx";
import { CategoryInput, Icon, NameInput, useCategorySuggestions, useTemplateSuggestions, type NameSuggestion } from "../components/gear.tsx";
import { fmtPrice, priceFrom } from "./RecommendedGear.tsx";
import { WeightBar, colorForCategory, type WeightSegment } from "../components/weightbar.tsx";
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
  const categorySuggestions = useCategorySuggestions();
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
  // Recommended-gear ids the scout has wishlisted this session (to flip the button).
  const [wishlisted, setWishlisted] = useState<Set<string>>(new Set());

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

  function addCategory(existing: string[], name?: string) {
    // A picked suggestion passes its value directly (setNewCat hasn't committed
    // yet); the button/Enter fall back to the current field.
    const c = (typeof name === "string" ? name : newCat).trim();
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

  // Delete the entire packing list bound to this event so the scout can reattach
  // (regenerate) a fresh one. Dangerous + rare — double-confirmed, then the page
  // drops back to the empty "Generate" state.
  async function deleteList() {
    if (!bundle?.list) return;
    if (!confirm("Delete this event's packing list? This removes all its items and cannot be undone. You can regenerate a fresh list afterward."))
      return;
    try {
      await api.deletePackingList(scout.id, eventId);
      load();
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

  // Add a missing item's suggested product to the active scout's wishlist.
  async function addToWishlist(gearId: string) {
    setWishlisted((prev) => new Set(prev).add(gearId)); // optimistic
    try {
      await api.addToWishlist(scout.id, { gear_id: gearId });
    } catch (e) {
      setWishlisted((prev) => {
        const next = new Set(prev);
        next.delete(gearId);
        return next;
      });
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

  // Stacked-bar segments: one per category that carries weight, sized by share
  // of the total. The hover breakdown lists each owned item's weight (heaviest
  // first); missing/unlinked items weigh nothing and are left out.
  const weightSegments: WeightSegment[] = renderCats
    .map((cat) => {
      const list = byCategory.get(cat) ?? [];
      const items = list
        .map((it) => ({ name: it.closet_item?.name ?? it.name, weight: weightOf(it) }))
        .filter((x) => x.weight > 0)
        .sort((a, b) => b.weight - a.weight);
      const value = items.reduce((a, x) => a + x.weight, 0);
      return { category: cat, color: colorForCategory(cat, renderCats), value, items };
    })
    .filter((s) => s.value > 0);

  // The whole closet is the palette; items already linked to a row on this list
  // are shown as used (a link badge, not draggable) rather than hidden.
  const linkedIds = new Set(items.map((i) => i.closet_item_id).filter((x): x is string => !!x));
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

      {weightSegments.length > 0 && <WeightBar segments={weightSegments} fmt={fmtKg} />}

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
                      wishlistedIds={wishlisted}
                      onWishlist={addToWishlist}
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
        <CategoryInput
          placeholder="New category name"
          value={newCat}
          // Only suggest categories not already on this packing list.
          options={categorySuggestions.filter(
            (c) => !renderCats.some((r) => r.toLowerCase() === c.toLowerCase()),
          )}
          onChange={setNewCat}
          onSubmit={(name) => addCategory(renderCats, name)}
        />
        <Button onClick={() => addCategory(renderCats)} disabled={!newCat.trim()}>
          + Add new category
        </Button>
      </div>

      <section className="sp-danger" aria-label="Danger zone">
        <h2 className="sp-danger__head">Danger zone</h2>
        <div className="sp-danger__row">
          <div className="sp-danger__copy">
            <strong>Delete this packing list</strong>
            <span className="t10-sub">
              Removes the list and all its items for this event. Use this to start over —
              you can regenerate a fresh list from the template afterward.
            </span>
          </div>
          <Button variant="danger" onClick={deleteList}>
            Delete packing list
          </Button>
        </div>
      </section>
    </div>

      <GearSidebar
        loading={closet === null}
        gear={closet ?? []}
        linkedIds={linkedIds}
        hasMissing={hasMissing}
        onDragStart={setGearDragId}
        onDragEnd={() => setGearDragId(null)}
      />
    </div>
  );
}

// The closet-as-palette sidebar shown next to a packing list: the whole closet,
// draggable onto a "missing" row to claim it. Items already used on this list are
// shown with a link badge instead of a drag handle (and aren't draggable).
function GearSidebar({
  loading,
  gear,
  linkedIds,
  hasMissing,
  onDragStart,
  onDragEnd,
}: {
  loading: boolean;
  gear: ClosetItem[];
  linkedIds: Set<string>;
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
        <p className="t10-sub">Your closet is empty.</p>
      ) : filtered.length === 0 ? (
        <p className="t10-sub">No gear matches “{query.trim()}”.</p>
      ) : (
        cats.map((cat) => (
          <div key={cat} className="sp-gearbar__cat">
            <h3 className="sp-gearbar__catname">{cat}</h3>
            <ul className="sp-gearchips">
              {(byCategory.get(cat) ?? []).map((it) => {
                const used = linkedIds.has(it.id);
                return (
                  <li
                    key={it.id}
                    className={`sp-gearchip${used ? " is-used" : ""}`}
                    draggable={!used}
                    onDragStart={
                      used
                        ? undefined
                        : (e) => {
                            e.dataTransfer.effectAllowed = "link";
                            onDragStart(it.id);
                          }
                    }
                    onDragEnd={used ? undefined : onDragEnd}
                    title={
                      used
                        ? `“${it.name}” is already on this packing list`
                        : `Drag “${it.name}” onto a missing item${
                            it.weight_grams != null ? ` · ${it.weight_grams} g` : ""
                          }`
                    }
                  >
                    {used ? (
                      <span className="sp-gearchip__used" title="Used on this list">
                        <Icon name="link" />
                      </span>
                    ) : (
                      <span className="sp-gearchip__grip" aria-hidden="true">⠿</span>
                    )}
                    <span className="sp-gearchip__name">{it.name}</span>
                    {it.weight_grams != null && (
                      <span className="sp-gearchip__w t10-num">{it.weight_grams}g</span>
                    )}
                  </li>
                );
              })}
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
  wishlistedIds,
  onWishlist,
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
  // Which picks (by gear id) are already on this scout's wishlist.
  wishlistedIds: Set<string>;
  onWishlist: (gearId: string) => void;
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
  // On a missing row, surface the leader-suggested picks so the scout can choose
  // one. Rendered as its own full-width row below the item (see below) so each
  // pick has the whole table width and stays on a single line.
  const showSuggest =
    !item.owned && !!item.recommendation && item.recommendation.picks.length > 0;
  return (
    <>
    <tr
      className={`${item.owned ? "" : "is-missing"}${showSuggest ? " has-suggest" : ""}${dragOver ? " is-dragover" : ""}${gearTarget ? " is-geartarget" : ""}`}
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
        {/* Read-only: the description follows the linked closet item, not the row. */}
        {item.closet_item?.description ? (
          <span className="sp-desc">{item.closet_item.description}</span>
        ) : (
          <span className="sp-desc sp-desc--empty">—</span>
        )}
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
    {showSuggest && item.recommendation && (
      <tr className="is-missing sp-suggest-row">
        <td colSpan={8}>
          <div className="sp-suggest">
            <div className="sp-suggest__head">
              Recommended: <span className="sp-suggest__set">{item.recommendation.set.name}</span>
              {item.recommendation.set.description && (
                <span className="sp-suggest__hint"> — {item.recommendation.set.description}</span>
              )}
            </div>
            <ul className="sp-suggest__picks">
              {item.recommendation.picks.map((p) => {
                const price = priceFrom(p);
                const added = wishlistedIds.has(p.gear.id);
                return (
                  <li key={p.gear.id} className="sp-suggest__pick">
                    {p.gear.pick_label && (
                      <span className="sp-suggest__tag">{p.gear.pick_label}</span>
                    )}
                    <span className="sp-suggest__name">{p.gear.name}</span>
                    {price != null && (
                      <span className="sp-suggest__price t10-num">from {fmtPrice(price)}</span>
                    )}
                    {p.gear.rationale && (
                      <span className="sp-suggest__why">{p.gear.rationale}</span>
                    )}
                    {added ? (
                      <span className="sp-suggest__done">✓ On wishlist</span>
                    ) : (
                      <button
                        className="sp-suggest__add"
                        onClick={() => onWishlist(p.gear.id)}
                        title={`Add ${p.gear.name} to wishlist`}
                      >
                        + Wishlist
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </td>
      </tr>
    )}
    </>
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

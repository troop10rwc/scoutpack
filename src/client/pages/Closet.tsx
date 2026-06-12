import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  ChangesetReview,
  Drawer,
  EmptyState,
  Field,
  SectionLabel,
  StatusPill,
  type Change,
} from "@troop10rwc/ui";
import { api } from "../api.ts";
import { usePageChrome } from "../chrome.tsx";
import { Icon, NameInput, useTemplateSuggestions, type NameSuggestion } from "../components/gear.tsx";
import { fmtPrice, priceFrom } from "./RecommendedGear.tsx";
import type {
  ClosetItem,
  ImportPreviewItem,
  RecommendedGearBundle,
  Scout,
} from "../../shared/types.ts";

// Distinct categorical palette for the donut + legend + section swatches, keyed
// by the category's alphabetical position. This is data-viz: a chart legitimately
// needs N distinguishable hues, which no single semantic token provides.
const PALETTE = [
  "#4f86c6", "#e8833a", "#cc3333", "#e0c020", "#a8d24a",
  "#4f9d3a", "#7e3ff2", "#39a0a0", "#d23a8a", "#9c6b3f",
  "#3a6ed2", "#7a7a7a",
];

type Unit = "metric" | "imperial";

const weightOf = (it: ClosetItem) => (it.weight_grams ?? 0) * it.quantity;
// Per-item weights are edited/displayed in grams; subtotals/totals use kg or lb.
const fmtBig = (grams: number, unit: Unit) =>
  unit === "imperial" ? `${(grams / 453.592).toFixed(2)} lb` : `${(grams / 1000).toFixed(2)} kg`;
// Gear quantities are small — clamp to 1–99 so the column stays two digits wide
// and totals can't balloon out of their column.
const clampQty = (v: string | number) => Math.min(99, Math.max(1, Math.floor(Number(v)) || 1));

export function Closet({ scout }: { scout: Scout }) {
  const [items, setItems] = useState<ClosetItem[] | null>(null);
  const suggestions = useTemplateSuggestions();
  // Categories created via "Add new category" that have no items yet — they
  // wouldn't appear in the item-derived list until something lands in them.
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
  const [newCat, setNewCat] = useState("");
  // Id of a just-created item whose name field should auto-focus for filling in.
  const [focusId, setFocusId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [unit, setUnit] = useState<Unit>(() =>
    typeof localStorage !== "undefined" && localStorage.getItem("closet-unit") === "imperial"
      ? "imperial"
      : "metric",
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [linkEditId, setLinkEditId] = useState<string | null>(null);
  // "Browse recommended" drawer: the catalog + which gear ids are wishlisted.
  const [browseOpen, setBrowseOpen] = useState(false);
  const [catalog, setCatalog] = useState<RecommendedGearBundle[] | null>(null);
  const [wishlistedIds, setWishlistedIds] = useState<Set<string>>(new Set());
  // Hidden file input shared by every row's camera button.
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string | null>(null);

  const totalGrams = (items ?? []).reduce((a, it) => a + weightOf(it), 0);
  usePageChrome(
    {
      title: `${scout.display_name}'s closet`,
      subtitle: `${items?.length ?? 0} items · ${fmtBig(totalGrams, unit)}`,
      actions: (
        <>
          <Button size="sm" onClick={() => setBrowseOpen(true)}>Browse recommended</Button>
          <div className="sp-unit" role="group" aria-label="Weight unit">
            <Button size="sm" variant={unit === "metric" ? "default" : "ghost"} onClick={() => changeUnit("metric")}>Metric</Button>
            <Button size="sm" variant={unit === "imperial" ? "default" : "ghost"} onClick={() => changeUnit("imperial")}>Imperial</Button>
          </div>
        </>
      ),
    },
    [scout.display_name, items?.length, totalGrams, unit],
  );

  useEffect(() => {
    setItems(null);
    api.listCloset(scout.id).then(setItems).catch((e: Error) => setErr(e.message));
  }, [scout.id]);

  // Load the recommended-gear catalog the first time the drawer is opened.
  useEffect(() => {
    if (browseOpen && catalog === null) {
      api.listRecommended().then(setCatalog).catch(() => setCatalog([]));
    }
  }, [browseOpen, catalog]);
  // Reset the per-scout wishlisted tracking when switching scouts.
  useEffect(() => setWishlistedIds(new Set()), [scout.id]);

  async function wishlistGear(gearId: string) {
    setWishlistedIds((prev) => new Set(prev).add(gearId)); // optimistic
    try {
      await api.addToWishlist(scout.id, { gear_id: gearId });
    } catch (e) {
      setWishlistedIds((prev) => {
        const next = new Set(prev);
        next.delete(gearId);
        return next;
      });
      setErr((e as Error).message);
    }
  }

  const categories = useMemo(
    () => [...new Set((items ?? []).map((i) => i.category))].sort((a, b) => a.localeCompare(b)),
    [items],
  );
  const colorFor = (cat: string) =>
    PALETTE[Math.max(0, categories.indexOf(cat)) % PALETTE.length];

  function changeUnit(u: Unit) {
    setUnit(u);
    try {
      localStorage.setItem("closet-unit", u);
    } catch {
      /* ignore storage failures (private mode) */
    }
  }

  // --- item mutations ---
  function editLocal(id: string, fields: Partial<ClosetItem>) {
    setItems((items) => (items ?? []).map((i) => (i.id === id ? { ...i, ...fields } : i)));
  }
  function patchItem(id: string, fields: Partial<ClosetItem>) {
    api
      .updateClosetItem(scout.id, id, fields)
      .then((updated) =>
        setItems((items) => (items ?? []).map((i) => (i.id === id ? updated : i))),
      )
      .catch((e: Error) => setErr(e.message));
  }

  // Create a blank, fillable item in the given category and focus its name.
  async function addItemTo(category: string) {
    try {
      const created = await api.createClosetItem(scout.id, {
        name: "New item",
        category,
        quantity: 1,
      });
      setItems((items) => [...(items ?? []), created]);
      setFocusId(created.id);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function addCategory() {
    const c = newCat.trim();
    if (!c) return;
    if (!categories.includes(c) && !extraCategories.includes(c)) {
      setExtraCategories((x) => [...x, c]);
    }
    setNewCat("");
  }

  async function remove(id: string) {
    if (!confirm("Delete this item?")) return;
    await api.deleteClosetItem(scout.id, id);
    setItems((items) => (items ?? []).filter((i) => i.id !== id));
  }

  // --- photos ---
  function pickPhoto(id: string) {
    uploadTarget.current = id;
    fileRef.current?.click();
  }
  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const id = uploadTarget.current;
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || !id) return;
    try {
      const updated = await api.uploadClosetImage(scout.id, id, file);
      setItems((items) => (items ?? []).map((i) => (i.id === id ? updated : i)));
    } catch (err) {
      setErr((err as Error).message);
    }
  }
  async function removePhoto(id: string) {
    await api.deleteClosetImage(scout.id, id).catch((e: Error) => setErr(e.message));
    editLocal(id, { image_key: null });
  }

  // --- drag reorder (within + across categories) ---
  function persistOrder(list: ClosetItem[]) {
    api
      .reorderCloset(
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
      if (!prev) return prev;
      const drag = prev.find((i) => i.id === id);
      if (!drag) return prev;
      const without = prev.filter((i) => i.id !== id);
      const moved: ClosetItem = { ...drag, category: targetCategory };
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

  if (err) return <EmptyState>{err}</EmptyState>;
  if (!items) return <EmptyState>Loading closet…</EmptyState>;

  const byCategory = new Map<string, ClosetItem[]>();
  for (const it of items) {
    const arr = byCategory.get(it.category) ?? [];
    arr.push(it);
    byCategory.set(it.category, arr);
  }
  // Item-derived categories plus any still-empty ones added by the user.
  const renderCats = [...new Set([...categories, ...extraCategories])].sort((a, b) =>
    a.localeCompare(b),
  );

  return (
    <div className="sp-page sp-closet">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={onFileChosen}
      />

      {items.length > 0 && <PackSummary items={items} colorFor={colorFor} unit={unit} />}

      {renderCats.map((cat) => {
        const list = byCategory.get(cat) ?? [];
        const subtotal = list.reduce((acc, it) => acc + weightOf(it), 0);
        const count = list.reduce((acc, it) => acc + it.quantity, 0);
        return (
          <section
            key={cat}
            className="sp-cat"
            onDragOver={(e) => dragId && e.preventDefault()}
            onDrop={() => dragId && dropOn(cat, null)}
          >
            <h2 className="sp-cat__head">
              <span className="sp-swatch" style={{ background: colorFor(cat) }} />
              {cat}
            </h2>
            <div className="sp-gearwrap">
            <table className="sp-gear">
              <thead>
                <tr>
                  <th className="sp-gear__grip"></th>
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
                  <GearRow
                    key={it.id}
                    item={it}
                    scoutId={scout.id}
                    suggestions={suggestions}
                    autoFocusName={focusId === it.id}
                    dragOver={dragOverId === it.id}
                    linkEditing={linkEditId === it.id}
                    onDragStart={() => setDragId(it.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setDragOverId(null);
                    }}
                    onDragEnter={() => dragId && dragId !== it.id && setDragOverId(it.id)}
                    onDrop={(e) => {
                      e.stopPropagation();
                      dropOn(it.category, it.id);
                    }}
                    onEditLocal={(f) => editLocal(it.id, f)}
                    onPatch={(f) => patchItem(it.id, f)}
                    onToggle={(f) => patchItem(it.id, f)}
                    onPickPhoto={() => pickPhoto(it.id)}
                    onRemovePhoto={() => removePhoto(it.id)}
                    onLinkEdit={() => setLinkEditId(it.id)}
                    onLinkDone={(url) => {
                      setLinkEditId(null);
                      if (url !== (it.link_url ?? "")) patchItem(it.id, { link_url: url || null });
                    }}
                    onRemove={() => remove(it.id)}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}></td>
                  <td className="is-right t10-num">{fmtBig(subtotal, unit)}</td>
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
          onKeyDown={(e) => e.key === "Enter" && addCategory()}
        />
        <Button onClick={addCategory} disabled={!newCat.trim()}>+ Add new category</Button>
      </div>

      <div className="sp-tools">
        <ImportSection
          scout={scout}
          onImported={(created) => setItems((items) => [...(items ?? []), ...created])}
        />
      </div>

      <RecommendedDrawer
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        catalog={catalog}
        scoutName={scout.display_name}
        wishlistedIds={wishlistedIds}
        onWishlist={wishlistGear}
      />
    </div>
  );
}

// Browse-the-catalog drawer opened from the closet headstrip. Scouts add items to
// their wishlist (parents buy them) rather than straight into the closet.
function RecommendedDrawer({
  open,
  onClose,
  catalog,
  scoutName,
  wishlistedIds,
  onWishlist,
}: {
  open: boolean;
  onClose: () => void;
  catalog: RecommendedGearBundle[] | null;
  scoutName: string;
  wishlistedIds: Set<string>;
  onWishlist: (gearId: string) => void;
}) {
  const byCat = new Map<string, RecommendedGearBundle[]>();
  for (const b of catalog ?? []) {
    const arr = byCat.get(b.gear.category) ?? [];
    arr.push(b);
    byCat.set(b.gear.category, arr);
  }
  const cats = [...byCat.keys()].sort((a, b) => a.localeCompare(b));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Recommended gear"
      subtitle={`Add to ${scoutName}’s wishlist`}
    >
      {catalog === null ? (
        <p className="t10-sub">Loading…</p>
      ) : catalog.length === 0 ? (
        <p className="t10-sub">No recommended gear yet.</p>
      ) : (
        <div className="sp-recbrowse">
          {cats.map((cat) => (
            <div key={cat} className="sp-recbrowse__cat">
              <SectionLabel>{cat}</SectionLabel>
              <ul className="sp-recbrowse__list">
                {(byCat.get(cat) ?? []).map((b) => {
                  const added = wishlistedIds.has(b.gear.id);
                  return (
                    <li key={b.gear.id} className="sp-recbrowse__item">
                      <div className="sp-recbrowse__info">
                        <span className="sp-recbrowse__name">{b.gear.name}</span>
                        {b.gear.brand && <span className="t10-sub"> · {b.gear.brand}</span>}
                        {priceFrom(b) != null && (
                          <span className="sp-recbrowse__price t10-num">
                            from {fmtPrice(priceFrom(b))}
                          </span>
                        )}
                      </div>
                      {added ? (
                        <StatusPill tone="ok">On wishlist</StatusPill>
                      ) : (
                        <Button size="sm" onClick={() => onWishlist(b.gear.id)}>
                          + Wishlist
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}

function GearRow({
  item,
  scoutId,
  suggestions,
  autoFocusName,
  dragOver,
  linkEditing,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDrop,
  onEditLocal,
  onPatch,
  onToggle,
  onPickPhoto,
  onRemovePhoto,
  onLinkEdit,
  onLinkDone,
  onRemove,
}: {
  item: ClosetItem;
  scoutId: string;
  suggestions: NameSuggestion[];
  autoFocusName: boolean;
  dragOver: boolean;
  linkEditing: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragEnter: () => void;
  onDrop: (e: React.DragEvent) => void;
  onEditLocal: (f: Partial<ClosetItem>) => void;
  onPatch: (f: Partial<ClosetItem>) => void;
  onToggle: (f: Partial<ClosetItem>) => void;
  onPickPhoto: () => void;
  onRemovePhoto: () => void;
  onLinkEdit: () => void;
  onLinkDone: (url: string) => void;
  onRemove: () => void;
}) {
  const imageUrl = item.image_key
    ? api.closetImageUrl(scoutId, item.id, item.image_key)
    : null;
  return (
    <>
      <tr
        className={dragOver ? "is-dragover" : ""}
        onDragOver={(e) => e.preventDefault()}
        onDragEnter={onDragEnter}
        onDrop={onDrop}
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
        <td>
          <NameInput
            value={item.name}
            suggestions={suggestions}
            autoFocus={autoFocusName}
            onChange={(v) => onEditLocal({ name: v })}
            onCommit={(v) => onPatch({ name: v.trim() || item.name })}
          />
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
          {imageUrl ? (
            <span className="sp-thumbwrap">
              <img className="sp-thumb" src={imageUrl} alt="" onClick={onPickPhoto} title="Replace photo" />
              <button className="sp-thumb-x" onClick={onRemovePhoto} title="Remove photo">×</button>
            </span>
          ) : (
            <button className="sp-iconbtn" onClick={onPickPhoto} title="Add photo">
              <Icon name="camera" />
            </button>
          )}
          <button
            className={`sp-iconbtn${item.link_url ? " is-on" : ""}`}
            onClick={onLinkEdit}
            title={item.link_url ? "Edit link" : "Add link"}
          >
            <Icon name="link" />
          </button>
          {item.link_url && (
            <a className="sp-iconbtn sp-iconbtn--link" href={item.link_url} target="_blank" rel="noreferrer" title="Open link">↗</a>
          )}
          <button
            className={`sp-iconbtn${item.is_worn ? " is-on" : ""}`}
            onClick={() => onToggle({ is_worn: item.is_worn ? 0 : 1 })}
            title="Worn"
          >
            <Icon name="shirt" />
          </button>
          <button
            className={`sp-iconbtn${item.is_consumable ? " is-on" : ""}`}
            onClick={() => onToggle({ is_consumable: item.is_consumable ? 0 : 1 })}
            title="Consumable"
          >
            <Icon name="utensils" />
          </button>
          <button
            className={`sp-iconbtn${item.is_favorite ? " is-on" : ""}`}
            onClick={() => onToggle({ is_favorite: item.is_favorite ? 0 : 1 })}
            title="Favorite"
          >
            <Icon name="star" filled={!!item.is_favorite} />
          </button>
        </td>
        <td className="is-right sp-gear__weight">
          <input
            className="sp-cell t10-num"
            type="number"
            value={item.weight_grams ?? ""}
            onChange={(e) =>
              onEditLocal({ weight_grams: e.target.value ? Number(e.target.value) : null })
            }
            onBlur={(e) =>
              onPatch({ weight_grams: e.target.value ? Number(e.target.value) : null })
            }
          />
          <span className="sp-unit-suffix">g</span>
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
          <button className="sp-iconbtn sp-iconbtn--del" onClick={onRemove} title="Delete item">×</button>
        </td>
      </tr>
      {linkEditing && (
        <tr className="sp-linkrow">
          <td></td>
          <td colSpan={6}>
            <input
              className="sp-cell"
              autoFocus
              placeholder="https://… (Enter to save, Esc to cancel)"
              defaultValue={item.link_url ?? ""}
              onKeyDown={(e) => {
                if (e.key === "Enter") onLinkDone((e.target as HTMLInputElement).value.trim());
                if (e.key === "Escape") onLinkDone(item.link_url ?? "");
              }}
              onBlur={(e) => onLinkDone(e.target.value.trim())}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function PackSummary({
  items,
  colorFor,
  unit,
}: {
  items: ClosetItem[];
  colorFor: (cat: string) => string;
  unit: Unit;
}) {
  const catTotals = new Map<string, number>();
  for (const it of items) {
    catTotals.set(it.category, (catTotals.get(it.category) ?? 0) + weightOf(it));
  }
  const cats = [...catTotals.keys()].sort((a, b) => a.localeCompare(b));
  const total = items.reduce((a, it) => a + weightOf(it), 0);
  const worn = items.filter((i) => i.is_worn).reduce((a, it) => a + weightOf(it), 0);
  const consumable = items
    .filter((i) => i.is_consumable)
    .reduce((a, it) => a + weightOf(it), 0);
  const base = total - worn - consumable;

  const segments = cats.map((c) => ({ color: colorFor(c), value: catTotals.get(c) ?? 0 }));

  return (
    <section className="sp-summary">
      <Donut segments={segments} />
      <table className="sp-legend">
        <thead>
          <tr>
            <th>Category</th>
            <th className="is-right">Weight</th>
          </tr>
        </thead>
        <tbody>
          {cats.map((c) => (
            <tr key={c}>
              <td>
                <span className="sp-swatch" style={{ background: colorFor(c) }} />
                {c}
              </td>
              <td className="is-right t10-num">{fmtBig(catTotals.get(c) ?? 0, unit)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="sp-legend__rule">
            <td>Total</td>
            <td className="is-right t10-num">{fmtBig(total, unit)}</td>
          </tr>
          <tr>
            <td>Consumable</td>
            <td className="is-right t10-num">{fmtBig(consumable, unit)}</td>
          </tr>
          <tr>
            <td>Worn</td>
            <td className="is-right t10-num">{fmtBig(worn, unit)}</td>
          </tr>
          <tr className="sp-legend__rule">
            <td>Base Weight</td>
            <td className="is-right t10-num">{fmtBig(base, unit)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

// Pure-SVG donut chart: one stroked arc per category, sized by weight share.
function Donut({ segments }: { segments: { color: string; value: number }[] }) {
  const r = 80;
  const cx = 100;
  const cy = 100;
  const circumference = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.value, 0);
  const gap = total > 0 ? 2 : 0; // small gap between segments
  let offset = 0;

  return (
    <svg viewBox="0 0 200 200" width={180} height={180} className="sp-donut">
      <g transform="rotate(-90 100 100)">
        {total === 0 ? (
          <circle cx={cx} cy={cy} r={r} fill="none" style={{ stroke: "var(--t10-line)" }} strokeWidth={38} />
        ) : (
          segments
            .filter((s) => s.value > 0)
            .map((s, i) => {
              const len = (s.value / total) * circumference;
              const dash = Math.max(len - gap, 0.0001);
              const el = (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={38}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return el;
            })
        )}
      </g>
    </svg>
  );
}

function ImportSection({
  scout,
  onImported,
}: {
  scout: Scout;
  onImported: (created: ClosetItem[]) => void;
}) {
  const [url, setUrl] = useState("");
  const [rows, setRows] = useState<ImportPreviewItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Model 5: the import URL fans out into many row inserts, so it gets a
  // reviewable changeset. Duplicates are excluded from the write and shown as
  // skipped notes — the preview is the description of exactly what Apply does.
  const importable = (rows ?? []).filter((r) => !r.duplicate);

  async function preview() {
    if (!url.trim()) return;
    setBusy(true);
    setErr(null);
    setApplied(false);
    try {
      const { items } = await api.previewClosetImport(scout.id, url.trim());
      setRows(items);
    } catch (e) {
      setErr((e as Error).message);
      setRows(null);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!importable.length) return;
    setBusy(true);
    setErr(null);
    try {
      const { items } = await api.importCloset(
        scout.id,
        importable.map((r) => ({
          name: r.name,
          category: r.category,
          description: r.description,
          weight_grams: r.weight_grams,
          quantity: r.quantity,
          is_worn: r.is_worn ? 1 : 0,
          is_consumable: r.is_consumable ? 1 : 0,
        })),
      );
      onImported(items);
      setApplied(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    setRows(null);
    setUrl("");
    setApplied(false);
    setErr(null);
  }

  const changes: Change[] = (rows ?? []).map((r, i) => {
    const weight = r.weight_grams ? `${r.weight_grams} g` : "—";
    return r.duplicate
      ? { id: String(i), title: r.name, note: "Already in closet — will be skipped" }
      : {
          id: String(i),
          title: r.name,
          now: `${r.category} · ${weight} · ×${r.quantity}`,
        };
  });

  return (
    <section className="sp-import">
      <SectionLabel>Import from LighterPack</SectionLabel>
      <div className="sp-import__row">
        <Field label="LighterPack URL">
          <input
            placeholder="https://lighterpack.com/r/… or CSV link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && preview()}
          />
        </Field>
        <Button onClick={preview} disabled={busy || !url.trim()}>
          {busy && !rows ? "Loading…" : "Preview"}
        </Button>
      </div>
      {err && <p className="sp-error">{err}</p>}

      {rows && (rows.length === 0 ? (
        <EmptyState>Nothing to import.</EmptyState>
      ) : (
        <div className="sp-import__review">
          <ChangesetReview
            title="Import to closet"
            changes={changes}
            applied={applied}
            warning={
              applied
                ? undefined
                : `Adds ${importable.length} item${importable.length === 1 ? "" : "s"} to ${scout.display_name}'s closet`
            }
            applyLabel={busy ? "Importing…" : `Import ${importable.length} item${importable.length === 1 ? "" : "s"}`}
            onApply={apply}
            onDiscard={discard}
          />
          {applied && (
            <div className="sp-import__done">
              <StatusPill tone="ok">Imported</StatusPill>
              <Button size="sm" onClick={discard}>Done</Button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

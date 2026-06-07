import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.ts";
import type { ClosetItem, ImportPreviewItem, Scout } from "../../shared/types.ts";

const BLANK: Partial<ClosetItem> = {
  name: "",
  category: "Misc",
  brand: "",
  description: "",
  weight_grams: null,
  quantity: 1,
  is_worn: 0,
  is_consumable: 0,
};

// Distinct, stable palette for category color-coding (donut + legend + section
// swatches), assigned by the category's alphabetical position.
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

export function Closet({ scout }: { scout: Scout }) {
  const [items, setItems] = useState<ClosetItem[] | null>(null);
  const [draft, setDraft] = useState<Partial<ClosetItem>>(BLANK);
  const [err, setErr] = useState<string | null>(null);
  const [unit, setUnit] = useState<Unit>(() =>
    typeof localStorage !== "undefined" && localStorage.getItem("closet-unit") === "imperial"
      ? "imperial"
      : "metric",
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [linkEditId, setLinkEditId] = useState<string | null>(null);
  // Hidden file input shared by every row's camera button.
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string | null>(null);

  useEffect(() => {
    setItems(null);
    api.listCloset(scout.id).then(setItems).catch((e: Error) => setErr(e.message));
  }, [scout.id]);

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

  async function add() {
    if (!draft.name?.trim() || !draft.category?.trim()) return;
    try {
      const created = await api.createClosetItem(scout.id, {
        ...draft,
        name: draft.name.trim(),
        category: draft.category.trim(),
      });
      setItems((items) => [...(items ?? []), created]);
      setDraft(BLANK);
    } catch (e) {
      setErr((e as Error).message);
    }
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

  if (err) return <div className="error">{err}</div>;
  if (!items) return <div className="loading">Loading closet…</div>;

  const byCategory = new Map<string, ClosetItem[]>();
  for (const it of items) {
    const arr = byCategory.get(it.category) ?? [];
    arr.push(it);
    byCategory.set(it.category, arr);
  }

  return (
    <div className="closet">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={onFileChosen}
      />

      <div className="closet-header">
        <h1>{scout.display_name}'s closet</h1>
        <div className="unit-toggle">
          <button
            className={unit === "metric" ? "active" : ""}
            onClick={() => changeUnit("metric")}
          >
            Metric
          </button>
          <button
            className={unit === "imperial" ? "active" : ""}
            onClick={() => changeUnit("imperial")}
          >
            Imperial
          </button>
        </div>
      </div>

      {items.length > 0 && <PackSummary items={items} colorFor={colorFor} unit={unit} />}

      {categories.map((cat) => {
        const list = byCategory.get(cat) ?? [];
        const subtotal = list.reduce((acc, it) => acc + weightOf(it), 0);
        const count = list.reduce((acc, it) => acc + it.quantity, 0);
        return (
          <section
            key={cat}
            className="category"
            onDragOver={(e) => dragId && e.preventDefault()}
            onDrop={() => dragId && dropOn(cat, null)}
          >
            <h2>
              <span className="swatch" style={{ background: colorFor(cat) }} />
              {cat}
            </h2>
            <table className="gear-table">
              <thead>
                <tr>
                  <th className="grip"></th>
                  <th className="name"></th>
                  <th className="desc"></th>
                  <th className="acts"></th>
                  <th className="num">Weight</th>
                  <th className="num">qty</th>
                  <th className="del"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((it) => (
                  <GearRow
                    key={it.id}
                    item={it}
                    scoutId={scout.id}
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
                  <td className="num">{fmtBig(subtotal, unit)}</td>
                  <td className="num">{count}</td>
                  <td className="del"></td>
                </tr>
              </tfoot>
            </table>
          </section>
        );
      })}
      {!items.length && <p className="empty">No items yet. Add gear you own below.</p>}

      <div className="closet-tools">
        <section className="add-item">
          <h2>Add gear</h2>
          <div className="row">
            <input
              placeholder="Name"
              value={draft.name ?? ""}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <input
              placeholder="Category"
              value={draft.category ?? ""}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            />
            <input
              placeholder="Brand"
              value={draft.brand ?? ""}
              onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
            />
            <input
              placeholder="Weight (g)"
              type="number"
              value={draft.weight_grams ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  weight_grams: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
            <input
              placeholder="Qty"
              type="number"
              min={1}
              value={draft.quantity ?? 1}
              onChange={(e) => setDraft({ ...draft, quantity: Number(e.target.value) })}
            />
            <label>
              <input
                type="checkbox"
                checked={!!draft.is_worn}
                onChange={(e) => setDraft({ ...draft, is_worn: e.target.checked ? 1 : 0 })}
              />
              worn
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!draft.is_consumable}
                onChange={(e) =>
                  setDraft({ ...draft, is_consumable: e.target.checked ? 1 : 0 })
                }
              />
              consumable
            </label>
            <button onClick={add}>Add</button>
          </div>
        </section>

        <ImportSection
          scout={scout}
          onImported={(created) => setItems((items) => [...(items ?? []), ...created])}
        />
      </div>
    </div>
  );
}

function GearRow({
  item,
  scoutId,
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
        className={dragOver ? "drag-over" : ""}
        onDragOver={(e) => e.preventDefault()}
        onDragEnter={onDragEnter}
        onDrop={onDrop}
      >
        <td className="grip">
          <span
            className="grip-handle"
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            title="Drag to reorder"
          >
            ⠿
          </span>
        </td>
        <td className="name">
          <input
            className="cell-edit"
            value={item.name}
            onChange={(e) => onEditLocal({ name: e.target.value })}
            onBlur={(e) => onPatch({ name: e.target.value.trim() || item.name })}
          />
        </td>
        <td className="desc">
          <input
            className="cell-edit"
            placeholder="description"
            value={item.description ?? ""}
            onChange={(e) => onEditLocal({ description: e.target.value })}
            onBlur={(e) => onPatch({ description: e.target.value || null })}
          />
        </td>
        <td className="acts">
          {imageUrl ? (
            <span className="thumb-wrap">
              <img className="thumb" src={imageUrl} alt="" onClick={onPickPhoto} title="Replace photo" />
              <button className="thumb-x" onClick={onRemovePhoto} title="Remove photo">
                ×
              </button>
            </span>
          ) : (
            <button className="icon-btn" onClick={onPickPhoto} title="Add photo">
              <Icon name="camera" />
            </button>
          )}
          <button
            className={`icon-btn${item.link_url ? " on" : ""}`}
            onClick={onLinkEdit}
            title={item.link_url ? "Edit link" : "Add link"}
          >
            <Icon name="link" />
          </button>
          {item.link_url && (
            <a className="icon-btn open-link" href={item.link_url} target="_blank" rel="noreferrer" title="Open link">
              ↗
            </a>
          )}
          <button
            className={`icon-btn${item.is_worn ? " on" : ""}`}
            onClick={() => onToggle({ is_worn: item.is_worn ? 0 : 1 })}
            title="Worn"
          >
            <Icon name="shirt" />
          </button>
          <button
            className={`icon-btn${item.is_consumable ? " on" : ""}`}
            onClick={() => onToggle({ is_consumable: item.is_consumable ? 0 : 1 })}
            title="Consumable"
          >
            <Icon name="utensils" />
          </button>
          <button
            className={`icon-btn${item.is_favorite ? " on" : ""}`}
            onClick={() => onToggle({ is_favorite: item.is_favorite ? 0 : 1 })}
            title="Favorite"
          >
            <Icon name="star" filled={!!item.is_favorite} />
          </button>
        </td>
        <td className="num weight-cell">
          <input
            className="cell-edit num"
            type="number"
            value={item.weight_grams ?? ""}
            onChange={(e) =>
              onEditLocal({ weight_grams: e.target.value ? Number(e.target.value) : null })
            }
            onBlur={(e) =>
              onPatch({ weight_grams: e.target.value ? Number(e.target.value) : null })
            }
          />
          <span className="unit-suffix">g</span>
        </td>
        <td className="num">
          <input
            className="cell-edit num qty"
            type="number"
            min={1}
            value={item.quantity}
            onChange={(e) => onEditLocal({ quantity: Number(e.target.value) || 1 })}
            onBlur={(e) => onPatch({ quantity: Number(e.target.value) || 1 })}
          />
        </td>
        <td className="del">
          <button className="icon" onClick={onRemove} title="Delete item">
            ×
          </button>
        </td>
      </tr>
      {linkEditing && (
        <tr className="link-edit-row">
          <td></td>
          <td colSpan={6}>
            <input
              className="cell-edit link-input"
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

function Icon({ name, filled }: { name: string; filled?: boolean }) {
  const p = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "camera":
      return (
        <svg {...p}>
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      );
    case "link":
      return (
        <svg {...p}>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      );
    case "shirt":
      return (
        <svg {...p}>
          <path d="M4 7l4-4 4 3 4-3 4 4-3 3-1-1v12H8V9L7 10z" />
        </svg>
      );
    case "utensils":
      return (
        <svg {...p}>
          <path d="M6 3v8M9 3v8M7.5 11v10M16 3c-1.6 0-2.5 2-2.5 5s1 4 2.5 4v9" />
        </svg>
      );
    case "star":
      return (
        <svg {...p} fill={filled ? "currentColor" : "none"}>
          <polygon points="12 2 15 9 22 9.3 17 14 18.2 21 12 17.5 5.8 21 7 14 2 9.3 9 9" />
        </svg>
      );
    default:
      return null;
  }
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
    <section className="pack-summary">
      <Donut segments={segments} />
      <table className="legend">
        <thead>
          <tr>
            <th>Category</th>
            <th className="num">Weight</th>
          </tr>
        </thead>
        <tbody>
          {cats.map((c) => (
            <tr key={c}>
              <td>
                <span className="swatch" style={{ background: colorFor(c) }} />
                {c}
              </td>
              <td className="num">{fmtBig(catTotals.get(c) ?? 0, unit)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="grand">
            <td>Total</td>
            <td className="num">{fmtBig(total, unit)}</td>
          </tr>
          <tr>
            <td>Consumable</td>
            <td className="num">{fmtBig(consumable, unit)}</td>
          </tr>
          <tr>
            <td>Worn</td>
            <td className="num">{fmtBig(worn, unit)}</td>
          </tr>
          <tr className="grand">
            <td>Base Weight</td>
            <td className="num">{fmtBig(base, unit)}</td>
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
  const gap = total > 0 ? 2 : 0; // small white gap between segments
  let offset = 0;

  return (
    <svg viewBox="0 0 200 200" width={180} height={180} className="donut">
      <g transform="rotate(-90 100 100)">
        {total === 0 ? (
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e5e5" strokeWidth={38} />
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

type PreviewRow = ImportPreviewItem & { include: boolean };

function ImportSection({
  scout,
  onImported,
}: {
  scout: Scout;
  onImported: (created: ClosetItem[]) => void;
}) {
  const [url, setUrl] = useState("");
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function preview() {
    if (!url.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const { items } = await api.previewClosetImport(scout.id, url.trim());
      // Duplicates default to off; everything else defaults to on.
      setRows(items.map((it) => ({ ...it, include: !it.duplicate })));
    } catch (e) {
      setErr((e as Error).message);
      setRows(null);
    } finally {
      setBusy(false);
    }
  }

  function toggle(idx: number) {
    setRows((rows) =>
      (rows ?? []).map((r, i) => (i === idx ? { ...r, include: !r.include } : r)),
    );
  }

  function cancel() {
    setRows(null);
    setErr(null);
  }

  async function doImport() {
    const chosen = (rows ?? []).filter((r) => r.include);
    if (!chosen.length) return;
    setBusy(true);
    setErr(null);
    try {
      const { items } = await api.importCloset(
        scout.id,
        chosen.map((r) => ({
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
      setRows(null);
      setUrl("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selected = (rows ?? []).filter((r) => r.include).length;

  return (
    <section className="import">
      <h2>Import from LighterPack</h2>
      <div className="row">
        <input
          className="import-url"
          placeholder="https://lighterpack.com/r/… or CSV link"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && preview()}
        />
        <button onClick={preview} disabled={busy || !url.trim()}>
          {busy && !rows ? "Loading…" : "Preview"}
        </button>
      </div>
      {err && <p className="error">{err}</p>}

      {rows && (
        <div className="import-preview">
          {rows.length === 0 ? (
            <p className="empty">Nothing to import.</p>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Name</th>
                    <th>Category</th>
                    <th className="num">Weight</th>
                    <th className="num">Qty</th>
                    <th>Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={r.include ? "" : "skipped"}>
                      <td>
                        <input
                          type="checkbox"
                          checked={r.include}
                          onChange={() => toggle(i)}
                        />
                      </td>
                      <td>
                        {r.name}
                        {r.duplicate && <span className="tag dup">duplicate</span>}
                      </td>
                      <td>{r.category}</td>
                      <td className="num">{r.weight_grams ? `${r.weight_grams} g` : ""}</td>
                      <td className="num">{r.quantity}</td>
                      <td>
                        {r.is_worn ? "worn " : ""}
                        {r.is_consumable ? "consumable" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="actions">
                <button onClick={doImport} disabled={busy || selected === 0}>
                  {busy ? "Importing…" : `Import ${selected} item${selected === 1 ? "" : "s"}`}
                </button>
                <button className="secondary" onClick={cancel} disabled={busy}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

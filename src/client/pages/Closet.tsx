import { useEffect, useMemo, useState } from "react";
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
// Per-item weight (small): grams or ounces. Subtotals/totals (big): kg or lb.
const fmtItem = (grams: number, unit: Unit) =>
  unit === "imperial" ? `${(grams / 28.3495).toFixed(1)} oz` : `${grams} g`;
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
  function changeUnit(u: Unit) {
    setUnit(u);
    try {
      localStorage.setItem("closet-unit", u);
    } catch {
      /* ignore storage failures (private mode) */
    }
  }

  useEffect(() => {
    setItems(null);
    api.listCloset(scout.id).then(setItems).catch((e: Error) => setErr(e.message));
  }, [scout.id]);

  // Categories in alphabetical order, used for color assignment + section order.
  const categories = useMemo(
    () => [...new Set((items ?? []).map((i) => i.category))].sort((a, b) => a.localeCompare(b)),
    [items],
  );
  const colorFor = (cat: string) =>
    PALETTE[Math.max(0, categories.indexOf(cat)) % PALETTE.length];

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
          <section key={cat} className="category">
            <h2>
              <span className="swatch" style={{ background: colorFor(cat) }} />
              {cat}
            </h2>
            <table>
              <thead>
                <tr>
                  <th className="name"></th>
                  <th className="desc"></th>
                  <th className="flags"></th>
                  <th className="num">Weight</th>
                  <th className="num">qty</th>
                  <th className="del"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((it) => (
                  <tr key={it.id}>
                    <td className="name">{it.name}</td>
                    <td className="desc">{it.description ?? it.brand ?? ""}</td>
                    <td className="flags">
                      {it.is_worn ? <span className="tag">worn</span> : null}
                      {it.is_consumable ? <span className="tag">consumable</span> : null}
                    </td>
                    <td className="num">
                      {it.weight_grams ? fmtItem(it.weight_grams, unit) : ""}
                    </td>
                    <td className="num">{it.quantity}</td>
                    <td className="del">
                      <button className="icon" onClick={() => remove(it.id)} title="Delete">
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}></td>
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

import { useEffect, useState } from "react";
import { Button, Drawer, EmptyState, Field, SectionLabel, StatusPill } from "@troop10rwc/ui";
import { api, type RecommendedGearInput } from "../api.ts";
import { usePageChrome } from "../chrome.tsx";
import type { RecommendedGearBundle } from "../../shared/types.ts";

// price_cents <-> a dollars text field. Empty / unparseable => null.
const centsToInput = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));
const inputToCents = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
export const fmtPrice = (c: number | null) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);
// Cheapest known option, for the catalog "from $X" column.
export function priceFrom(b: RecommendedGearBundle): number | null {
  const prices = b.options.map((o) => o.price_cents).filter((p): p is number => p != null);
  return prices.length ? Math.min(...prices) : null;
}

type OptionDraft = { vendor: string; price: string; url: string; note: string };
type Draft = {
  id: string | null; // null => creating a new item
  name: string;
  category: string;
  description: string;
  brand: string;
  weight: string;
  options: OptionDraft[];
};

const blankOption = (): OptionDraft => ({ vendor: "", price: "", url: "", note: "" });
const blankDraft = (): Draft => ({
  id: null,
  name: "",
  category: "",
  description: "",
  brand: "",
  weight: "",
  options: [blankOption()],
});

function toDraft(b: RecommendedGearBundle): Draft {
  return {
    id: b.gear.id,
    name: b.gear.name,
    category: b.gear.category,
    description: b.gear.description ?? "",
    brand: b.gear.brand ?? "",
    weight: b.gear.weight_grams != null ? String(b.gear.weight_grams) : "",
    options: b.options.length
      ? b.options.map((o) => ({
          vendor: o.vendor,
          price: centsToInput(o.price_cents),
          url: o.url ?? "",
          note: o.note ?? "",
        }))
      : [blankOption()],
  };
}

export function RecommendedGear() {
  const [items, setItems] = useState<RecommendedGearBundle[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const active = (items ?? []).filter((b) => b.gear.is_active);
  usePageChrome(
    {
      title: "Recommended Gear",
      subtitle: `${active.length} item${active.length === 1 ? "" : "s"}`,
      actions: (
        <Button variant="primary" onClick={() => setDraft(blankDraft())}>
          + New item
        </Button>
      ),
    },
    [active.length],
  );

  function load() {
    api
      .listRecommended(true)
      .then(setItems)
      .catch((e: Error) => setErr(e.message));
  }
  useEffect(load, []);

  async function save() {
    if (!draft) return;
    if (!draft.name.trim() || !draft.category.trim()) {
      setErr("Name and category are required.");
      return;
    }
    setSaving(true);
    setErr(null);
    const body: RecommendedGearInput = {
      name: draft.name.trim(),
      category: draft.category.trim(),
      description: draft.description.trim() || null,
      brand: draft.brand.trim() || null,
      weight_grams: draft.weight.trim() ? Number(draft.weight) : null,
      options: draft.options
        .filter((o) => o.vendor.trim())
        .map((o) => ({
          vendor: o.vendor.trim(),
          price_cents: inputToCents(o.price),
          url: o.url.trim() || null,
          note: o.note.trim() || null,
        })),
    };
    try {
      if (draft.id) await api.updateRecommended(draft.id, body);
      else await api.createRecommended(body);
      setDraft(null);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!draft?.id) return;
    if (!confirm(`Archive “${draft.name}”? It stays linked where already used, but is hidden from pickers.`))
      return;
    try {
      await api.archiveRecommended(draft.id);
      setDraft(null);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (err && !items) return <EmptyState>{err}</EmptyState>;
  if (!items) return <EmptyState>Loading…</EmptyState>;

  // Group catalog by category for the list.
  const byCat = new Map<string, RecommendedGearBundle[]>();
  for (const b of active) {
    const arr = byCat.get(b.gear.category) ?? [];
    arr.push(b);
    byCat.set(b.gear.category, arr);
  }
  const cats = [...byCat.keys()].sort((a, b) => a.localeCompare(b));
  const archived = items.filter((b) => !b.gear.is_active);

  return (
    <div className="sp-page sp-rec">
      {err && <p className="sp-error">{err}</p>}
      {active.length === 0 ? (
        <EmptyState>No recommended gear yet — add the first item.</EmptyState>
      ) : (
        cats.map((cat) => (
          <section key={cat} className="sp-cat">
            <h2 className="sp-cat__head">{cat}</h2>
            <div className="sp-gearwrap">
              <table className="sp-gear">
                <thead>
                  <tr>
                    <th className="sp-gear__name">Item</th>
                    <th>Brand</th>
                    <th className="is-right">From</th>
                    <th className="is-right">Options</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(byCat.get(cat) ?? []).map((b) => (
                    <tr key={b.gear.id}>
                      <td className="sp-gear__name">{b.gear.name}</td>
                      <td>{b.gear.brand || <span className="t10-sub">—</span>}</td>
                      <td className="is-right t10-num">{fmtPrice(priceFrom(b))}</td>
                      <td className="is-right t10-num">{b.options.length}</td>
                      <td className="is-right">
                        <Button size="sm" onClick={() => setDraft(toDraft(b))}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      {archived.length > 0 && (
        <section className="sp-cat sp-rec__archived">
          <h2 className="sp-cat__head">
            Archived <span className="t10-sub">({archived.length})</span>
          </h2>
          <ul className="sp-rec__archlist">
            {archived.map((b) => (
              <li key={b.gear.id}>
                {b.gear.name} <span className="t10-sub">· {b.gear.category}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Drawer
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit recommended item" : "New recommended item"}
        subtitle={draft?.id ? draft.name : "Add a product with where-to-buy options"}
        footer={
          draft && (
            <div className="sp-rec__footer">
              {draft.id && (
                <Button variant="danger" onClick={archive}>
                  Archive
                </Button>
              )}
              <span className="sp-rec__footerspacer" />
              <Button onClick={() => setDraft(null)}>Cancel</Button>
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : draft.id ? "Save" : "Create"}
              </Button>
            </div>
          )
        }
      >
        {draft && (
          <div className="sp-rec__form">
            <Field label="Name">
              <input
                value={draft.name}
                placeholder="e.g. Nemo Disco 30 sleeping bag"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <div className="sp-rec__row2">
              <Field label="Category">
                <input
                  value={draft.category}
                  placeholder="Sleep System"
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                />
              </Field>
              <Field label="Brand">
                <input
                  value={draft.brand}
                  onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
                />
              </Field>
            </div>
            <div className="sp-rec__row2">
              <Field label="Weight (g)">
                <input
                  type="number"
                  value={draft.weight}
                  onChange={(e) => setDraft({ ...draft, weight: e.target.value })}
                />
              </Field>
              <span />
            </div>
            <Field label="Description">
              <input
                value={draft.description}
                placeholder="Why we recommend it"
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </Field>

            <SectionLabel>Where to buy</SectionLabel>
            <div className="sp-rec__opts">
              {draft.options.map((o, i) => (
                <div key={i} className="sp-rec__opt">
                  <input
                    className="sp-rec__optvendor"
                    placeholder="Vendor (REI, Amazon…)"
                    value={o.vendor}
                    onChange={(e) => {
                      const options = [...draft.options];
                      options[i] = { ...o, vendor: e.target.value };
                      setDraft({ ...draft, options });
                    }}
                  />
                  <input
                    className="sp-rec__optprice"
                    placeholder="$"
                    value={o.price}
                    onChange={(e) => {
                      const options = [...draft.options];
                      options[i] = { ...o, price: e.target.value };
                      setDraft({ ...draft, options });
                    }}
                  />
                  <input
                    className="sp-rec__opturl"
                    placeholder="https://…"
                    value={o.url}
                    onChange={(e) => {
                      const options = [...draft.options];
                      options[i] = { ...o, url: e.target.value };
                      setDraft({ ...draft, options });
                    }}
                  />
                  <input
                    className="sp-rec__optnote"
                    placeholder="note"
                    value={o.note}
                    onChange={(e) => {
                      const options = [...draft.options];
                      options[i] = { ...o, note: e.target.value };
                      setDraft({ ...draft, options });
                    }}
                  />
                  <button
                    className="sp-iconbtn sp-iconbtn--del"
                    title="Remove option"
                    onClick={() =>
                      setDraft({ ...draft, options: draft.options.filter((_, j) => j !== i) })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDraft({ ...draft, options: [...draft.options, blankOption()] })}
              >
                + Add buy option
              </Button>
            </div>
            {draft.id && (
              <p className="t10-sub">
                <StatusPill tone="neutral">Tip</StatusPill> Link this product to a template item on
                the Templates page.
              </p>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

import { useEffect, useState } from "react";
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
import { api, type RecommendationSetInput } from "../api.ts";
import { usePageChrome } from "../chrome.tsx";
import type { RecommendationSetBundle, RecommendedGearBundle } from "../../shared/types.ts";

// price_cents <-> a dollars text field. Empty / unparseable => null.
const centsToInput = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));
const inputToCents = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
export const fmtPrice = (c: number | null) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);
// Cheapest known buy option for a single pick.
export function priceFrom(b: RecommendedGearBundle): number | null {
  const prices = b.options.map((o) => o.price_cents).filter((p): p is number => p != null);
  return prices.length ? Math.min(...prices) : null;
}
// Cheapest across all picks in a set.
function setPriceFrom(s: RecommendationSetBundle): number | null {
  const all = s.picks.map(priceFrom).filter((p): p is number => p != null);
  return all.length ? Math.min(...all) : null;
}

const k = () => crypto.randomUUID();

type OptionDraft = { vendor: string; price: string; url: string; note: string };
type PickDraft = {
  key: string;
  id: string | null; // server id (null => new)
  name: string;
  label: string;
  brand: string;
  weight: string;
  rationale: string;
  options: OptionDraft[];
};
type SetDraft = {
  id: string | null;
  name: string;
  category: string;
  description: string;
  picks: PickDraft[];
};

const blankOption = (): OptionDraft => ({ vendor: "", price: "", url: "", note: "" });
const blankPick = (): PickDraft => ({
  key: k(),
  id: null,
  name: "",
  label: "",
  brand: "",
  weight: "",
  rationale: "",
  options: [blankOption()],
});
const blankSet = (): SetDraft => ({
  id: null,
  name: "",
  category: "",
  description: "",
  picks: [blankPick()],
});

function toSetDraft(b: RecommendationSetBundle): SetDraft {
  return {
    id: b.set.id,
    name: b.set.name,
    category: b.set.category,
    description: b.set.description ?? "",
    picks: (b.picks.length ? b.picks : []).map((p) => ({
      key: k(),
      id: p.gear.id,
      name: p.gear.name,
      label: p.gear.pick_label ?? "",
      brand: p.gear.brand ?? "",
      weight: p.gear.weight_grams != null ? String(p.gear.weight_grams) : "",
      rationale: p.gear.rationale ?? "",
      options: p.options.length
        ? p.options.map((o) => ({
            vendor: o.vendor,
            price: centsToInput(o.price_cents),
            url: o.url ?? "",
            note: o.note ?? "",
          }))
        : [blankOption()],
    })),
  };
}

export function RecommendedGear() {
  const [sets, setSets] = useState<RecommendationSetBundle[] | null>(null);
  const [draft, setDraft] = useState<SetDraft | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const active = (sets ?? []).filter((b) => b.set.is_active);
  usePageChrome(
    {
      title: "Recommended Gear",
      subtitle: `${active.length} need${active.length === 1 ? "" : "s"}`,
      actions: (
        <>
          <Button onClick={() => setImportOpen(true)}>Import CSV</Button>
          <Button variant="primary" onClick={() => setDraft(blankSet())}>+ New need</Button>
        </>
      ),
    },
    [active.length],
  );

  function load() {
    api.listRecommendationSets(true).then(setSets).catch((e: Error) => setErr(e.message));
  }
  useEffect(load, []);

  // --- nested draft updaters ---
  const editPick = (key: string, patch: Partial<PickDraft>) =>
    setDraft((d) =>
      d ? { ...d, picks: d.picks.map((p) => (p.key === key ? { ...p, ...patch } : p)) } : d,
    );
  const editOption = (pickKey: string, idx: number, patch: Partial<OptionDraft>) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            picks: d.picks.map((p) =>
              p.key === pickKey
                ? { ...p, options: p.options.map((o, i) => (i === idx ? { ...o, ...patch } : o)) }
                : p,
            ),
          }
        : d,
    );

  async function save() {
    if (!draft) return;
    if (!draft.name.trim() || !draft.category.trim()) {
      setErr("Need name and category are required.");
      return;
    }
    setSaving(true);
    setErr(null);
    const body: RecommendationSetInput = {
      name: draft.name.trim(),
      category: draft.category.trim(),
      description: draft.description.trim() || null,
      picks: draft.picks
        .filter((p) => p.name.trim())
        .map((p) => ({
          id: p.id ?? undefined,
          name: p.name.trim(),
          brand: p.brand.trim() || null,
          weight_grams: p.weight.trim() ? Number(p.weight) : null,
          pick_label: p.label.trim() || null,
          rationale: p.rationale.trim() || null,
          options: p.options
            .filter((o) => o.vendor.trim())
            .map((o) => ({
              vendor: o.vendor.trim(),
              price_cents: inputToCents(o.price),
              url: o.url.trim() || null,
              note: o.note.trim() || null,
            })),
        })),
    };
    try {
      if (draft.id) await api.updateRecommendationSet(draft.id, body);
      else await api.createRecommendationSet(body);
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
      await api.archiveRecommendationSet(draft.id);
      setDraft(null);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (err && !sets) return <EmptyState>{err}</EmptyState>;
  if (!sets) return <EmptyState>Loading…</EmptyState>;

  const byCat = new Map<string, RecommendationSetBundle[]>();
  for (const b of active) {
    const arr = byCat.get(b.set.category) ?? [];
    arr.push(b);
    byCat.set(b.set.category, arr);
  }
  const cats = [...byCat.keys()].sort((a, b) => a.localeCompare(b));
  const archived = sets.filter((b) => !b.set.is_active);

  return (
    <div className="sp-page sp-rec">
      {err && <p className="sp-error">{err}</p>}
      {active.length === 0 ? (
        <EmptyState>No recommendations yet — add a need, or import a CSV.</EmptyState>
      ) : (
        cats.map((cat) => (
          <section key={cat} className="sp-cat">
            <h2 className="sp-cat__head">{cat}</h2>
            {(byCat.get(cat) ?? []).map((b) => (
              <div key={b.set.id} className="sp-recneed">
                <div className="sp-recneed__head">
                  <span className="sp-recneed__name">{b.set.name}</span>
                  <span className="t10-sub">
                    {b.picks.length} option{b.picks.length === 1 ? "" : "s"}
                    {setPriceFrom(b) != null && ` · from ${fmtPrice(setPriceFrom(b))}`}
                  </span>
                  <span className="sp-recneed__spacer" />
                  <Button size="sm" onClick={() => setDraft(toSetDraft(b))}>Edit</Button>
                </div>
                {b.set.description && <p className="sp-recneed__how t10-sub">{b.set.description}</p>}
                <ul className="sp-recneed__picks">
                  {b.picks.map((p) => (
                    <li key={p.gear.id} className="sp-recneed__pick">
                      <span className="sp-recneed__pickname">{p.gear.name}</span>
                      {p.gear.pick_label && (
                        <span className="sp-recbrowse__tag">{p.gear.pick_label}</span>
                      )}
                      {p.gear.brand && <span className="t10-sub">· {p.gear.brand}</span>}
                      {priceFrom(p) != null && (
                        <span className="sp-recneed__price t10-num">from {fmtPrice(priceFrom(p))}</span>
                      )}
                      {p.gear.rationale && (
                        <span className="sp-recneed__why">{p.gear.rationale}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))
      )}

      {archived.length > 0 && (
        <section className="sp-cat sp-rec__archived">
          <h2 className="sp-cat__head">Archived <span className="t10-sub">({archived.length})</span></h2>
          <ul className="sp-rec__archlist">
            {archived.map((b) => (
              <li key={b.set.id}>{b.set.name} <span className="t10-sub">· {b.set.category}</span></li>
            ))}
          </ul>
        </section>
      )}

      <SetEditorDrawer
        draft={draft}
        saving={saving}
        onClose={() => setDraft(null)}
        onChange={setDraft}
        onEditPick={editPick}
        onEditOption={editOption}
        onSave={save}
        onArchive={archive}
      />
      <CsvImportDrawer
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          setImportOpen(false);
          load();
        }}
      />
    </div>
  );
}

function SetEditorDrawer({
  draft,
  saving,
  onClose,
  onChange,
  onEditPick,
  onEditOption,
  onSave,
  onArchive,
}: {
  draft: SetDraft | null;
  saving: boolean;
  onClose: () => void;
  onChange: (d: SetDraft) => void;
  onEditPick: (key: string, patch: Partial<PickDraft>) => void;
  onEditOption: (pickKey: string, idx: number, patch: Partial<OptionDraft>) => void;
  onSave: () => void;
  onArchive: () => void;
}) {
  return (
    <Drawer
      open={draft !== null}
      onClose={onClose}
      title={draft?.id ? "Edit need" : "New need"}
      subtitle={draft?.id ? draft.name : "A gear need with 1-3 product picks"}
      footer={
        draft && (
          <div className="sp-rec__footer">
            {draft.id && <Button variant="danger" onClick={onArchive}>Archive</Button>}
            <span className="sp-rec__footerspacer" />
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={onSave} disabled={saving}>
              {saving ? "Saving…" : draft.id ? "Save" : "Create"}
            </Button>
          </div>
        )
      }
    >
      {draft && (
        <div className="sp-rec__form">
          <Field label="Need">
            <input
              value={draft.name}
              placeholder="e.g. Backpacking sleeping bag"
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label="Category">
            <input
              value={draft.category}
              placeholder="Sleep System"
              onChange={(e) => onChange({ ...draft, category: e.target.value })}
            />
          </Field>
          <Field label="How to choose (optional)">
            <input
              value={draft.description}
              placeholder="What to weigh — cost vs. durability vs. weight"
              onChange={(e) => onChange({ ...draft, description: e.target.value })}
            />
          </Field>

          <SectionLabel>Product picks</SectionLabel>
          {draft.picks.map((p) => (
            <div key={p.key} className="sp-rec__pick">
              <div className="sp-rec__pickhead">
                <input
                  className="sp-rec__pickname"
                  placeholder="Product (e.g. Nemo Disco 30)"
                  value={p.name}
                  onChange={(e) => onEditPick(p.key, { name: e.target.value })}
                />
                <input
                  className="sp-rec__picklabel"
                  placeholder="Best for… (Budget)"
                  value={p.label}
                  onChange={(e) => onEditPick(p.key, { label: e.target.value })}
                />
                <button
                  className="sp-iconbtn sp-iconbtn--del"
                  title="Remove pick"
                  onClick={() =>
                    onChange({ ...draft, picks: draft.picks.filter((x) => x.key !== p.key) })
                  }
                >
                  ×
                </button>
              </div>
              <div className="sp-rec__pickrow">
                <input
                  className="sp-rec__pickbrand"
                  placeholder="Brand"
                  value={p.brand}
                  onChange={(e) => onEditPick(p.key, { brand: e.target.value })}
                />
                <input
                  className="sp-rec__pickweight"
                  type="number"
                  placeholder="g"
                  value={p.weight}
                  onChange={(e) => onEditPick(p.key, { weight: e.target.value })}
                />
                <input
                  className="sp-rec__pickrationale"
                  placeholder="Why pick this"
                  value={p.rationale}
                  onChange={(e) => onEditPick(p.key, { rationale: e.target.value })}
                />
              </div>
              <div className="sp-rec__opts">
                {p.options.map((o, i) => (
                  <div key={i} className="sp-rec__opt">
                    <input
                      className="sp-rec__optvendor"
                      placeholder="Vendor"
                      value={o.vendor}
                      onChange={(e) => onEditOption(p.key, i, { vendor: e.target.value })}
                    />
                    <input
                      className="sp-rec__optprice"
                      placeholder="$"
                      value={o.price}
                      onChange={(e) => onEditOption(p.key, i, { price: e.target.value })}
                    />
                    <input
                      className="sp-rec__opturl"
                      placeholder="https://…"
                      value={o.url}
                      onChange={(e) => onEditOption(p.key, i, { url: e.target.value })}
                    />
                    <button
                      className="sp-iconbtn sp-iconbtn--del"
                      title="Remove buy option"
                      onClick={() =>
                        onEditPick(p.key, { options: p.options.filter((_, j) => j !== i) })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onEditPick(p.key, { options: [...p.options, blankOption()] })}
                >
                  + Buy option
                </Button>
              </div>
            </div>
          ))}
          <Button size="sm" onClick={() => onChange({ ...draft, picks: [...draft.picks, blankPick()] })}>
            + Add pick
          </Button>
        </div>
      )}
    </Drawer>
  );
}

const CSV_PLACEHOLDER = `set,category,product,label,brand,weight_g,rationale,buy_options
Backpacking sleeping bag,Sleep System,Kelty Cosmic 20,Budget,Kelty,1560,Warm and affordable but heavier,"REI|159.95|https://rei.com/x; Amazon|149|https://amzn.to/y"
Backpacking sleeping bag,Sleep System,REI Magma 30,Most durable,REI,765,Premium down holds up for years,"REI|329|https://rei.com/z"`;

// A self-contained prompt a leader can paste into any AI agent to generate a CSV
// in exactly the shape this importer expects. The agent returns the CSV, which
// the leader pastes into the box above.
const LLM_PROMPT = `You are helping a Scouts BSA troop build a catalog of recommended gear. Produce a CSV I can paste directly into our gear app's importer.

Output ONLY the CSV — no commentary, no markdown, no code fences. Use this exact header row, then one row per product:

set,category,product,label,brand,weight_g,rationale,buy_options

Column rules:
- set: the gear NEED (the generic item a scout must bring, e.g. "Backpacking sleeping bag"). Repeat it across that need's picks — rows sharing a set are grouped as alternatives.
- category: a gear category (e.g. Sleep System, Hiking Gear, Clothing, Camp, Mess Kit, Personal).
- product: a specific, real, currently-available product (brand + model).
- label: the "best for" tag in 1-3 words — what makes this the right pick (e.g. Budget, Most durable, Lightest, Best all-around).
- brand: the manufacturer.
- weight_g: item weight in grams (whole number; leave blank if unknown).
- rationale: one short sentence on why a scout would choose this pick.
- buy_options: where to buy, as vendor|price|url triples separated by ";". Price in US dollars, number only. URL optional. Wrap this cell in double quotes because it contains commas/semicolons. Example: "REI|159.95|https://www.rei.com/...; Amazon|149|https://www.amazon.com/..."

Guidance:
- Give each need 2-3 picks that trade off on cost, durability, and weight.
- Use realistic current prices and youth/entry-appropriate gear suitable for Scouts BSA backpacking and car camping.

Cover these gear needs: <REPLACE WITH YOUR LIST, e.g. backpacking sleeping bag, sleeping pad, backpack, headlamp, water filter, backpacking stove>

Example of the exact format:
set,category,product,label,brand,weight_g,rationale,buy_options
Backpacking sleeping bag,Sleep System,Kelty Cosmic 20,Budget,Kelty,1560,Warm down bag at a low price,"REI|159.95|https://www.rei.com/x; Amazon|149|https://www.amazon.com/y"
Backpacking sleeping bag,Sleep System,REI Magma 30,Most durable,REI Co-op,765,Premium down that holds up for years,"REI|329|https://www.rei.com/z"`;

function CsvImportDrawer({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.previewRecommendationCsv>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(LLM_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setErr("Couldn’t copy — your browser blocked clipboard access.");
    }
  }

  function reset() {
    setCsv("");
    setPreview(null);
    setApplied(false);
    setErr(null);
  }

  async function doPreview() {
    if (!csv.trim()) return;
    setBusy(true);
    setErr(null);
    setApplied(false);
    try {
      setPreview(await api.previewRecommendationCsv(csv));
    } catch (e) {
      setErr((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setErr(null);
    try {
      await api.importRecommendationCsv(csv);
      setApplied(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const changes: Change[] = (preview?.sets ?? []).map((s, i) => ({
    id: String(i),
    title: s.name,
    now: `${s.picks} pick${s.picks === 1 ? "" : "s"}${s.status === "update" ? ` · ${s.newPicks} new` : ""}`,
    note: s.status === "new" ? "New need" : "Updates existing need",
  }));

  return (
    <Drawer
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      title="Import recommendations"
      subtitle="Paste a CSV — one row per product"
    >
      <div className="sp-rec__import">
        <p className="t10-sub">
          Columns: <code>set, category, product, label, brand, weight_g, rationale, buy_options</code>.
          Rows sharing a <code>set</code> group together. <code>buy_options</code> is{" "}
          <code>vendor|price|url</code> separated by <code>;</code>.
        </p>
        <div className="sp-rec__llm">
          <span className="t10-sub">Don’t have a CSV yet?</span>
          <Button size="sm" onClick={copyPrompt}>
            {copied ? "✓ Copied prompt" : "Copy prompt for an AI agent"}
          </Button>
          <span className="t10-sub">
            Paste it into ChatGPT/Claude, then paste the CSV it returns below.
          </span>
        </div>
        <textarea
          className="sp-rec__csv"
          placeholder={CSV_PLACEHOLDER}
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setPreview(null);
            setApplied(false);
          }}
          rows={10}
        />
        {err && <p className="sp-error">{err}</p>}
        {!preview ? (
          <Button variant="primary" onClick={doPreview} disabled={busy || !csv.trim()}>
            {busy ? "Checking…" : "Preview"}
          </Button>
        ) : (
          <ChangesetReview
            title="Import to catalog"
            changes={changes}
            applied={applied}
            warning={
              applied
                ? undefined
                : `Upserts ${preview.setCount} need${preview.setCount === 1 ? "" : "s"} · ${preview.pickCount} pick${preview.pickCount === 1 ? "" : "s"}`
            }
            applyLabel={busy ? "Importing…" : "Apply import"}
            onApply={apply}
            onDiscard={reset}
          />
        )}
        {applied && (
          <div className="sp-import__done">
            <StatusPill tone="ok">Imported</StatusPill>
            <Button size="sm" onClick={onImported}>Done</Button>
          </div>
        )}
      </div>
    </Drawer>
  );
}

import { useEffect, useState } from "react";
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  StatusPill,
  Toolbar,
  ToolbarSpacer,
  statusCell,
  type Column,
} from "@troop10rwc/ui";
import { api } from "../api.ts";
import { usePageChrome } from "../chrome.tsx";
import { EVENT_TYPES, EVENT_TYPE_LABELS, type EventType } from "../../shared/constants.ts";
import type { RecommendationSetBundle, TemplateBundle, TemplateItem } from "../../shared/types.ts";

type DraftItem = Omit<TemplateItem, "id" | "template_id" | "match_key">;
// Drafts have no server id; carry a stable client key for selection + edit-in-place.
type Row = DraftItem & { _k: string };

const key = () => crypto.randomUUID();

export function Templates() {
  const [eventType, setEventType] = useState<EventType>("backpacking");
  const [bundle, setBundle] = useState<TemplateBundle | null>(null);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Recommendation sets, for the "Suggested" column.
  const [catalog, setCatalog] = useState<RecommendationSetBundle[]>([]);

  usePageChrome(
    { title: "Templates", subtitle: `${EVENT_TYPE_LABELS[eventType]} · ${rows.length} items` },
    [eventType, rows.length],
  );

  useEffect(() => {
    api.listRecommendationSets().then(setCatalog).catch(() => setCatalog([]));
  }, []);

  useEffect(() => {
    setBundle(null);
    setSaved(false);
    setSel([]);
    api.getTemplate(eventType)
      .then((b) => {
        setBundle(b);
        setName(b.template.name);
        setRows(b.items.map(({ id, template_id, match_key, ...rest }) => ({ ...rest, _k: key() })));
      })
      .catch((e: Error) => setErr(e.message));
  }, [eventType]);

  function commit(_k: string, col: string, value: string | number) {
    setSaved(false);
    setRows((curr) =>
      curr.map((r) => {
        if (r._k !== _k) return r;
        switch (col) {
          case "name": return { ...r, name: String(value) };
          case "category": return { ...r, category: String(value) };
          case "default_qty": return { ...r, default_qty: Number(value) || 1 };
          case "is_worn": return { ...r, is_worn: Number(value) ? 1 : 0 };
          case "is_consumable": return { ...r, is_consumable: Number(value) ? 1 : 0 };
          case "recommendation_set_id": return { ...r, recommendation_set_id: String(value) || null };
          default: return r;
        }
      }),
    );
  }

  function addRow() {
    setSaved(false);
    setRows((curr) => [
      ...curr,
      {
        _k: key(),
        name: "",
        description: null,
        category: "Misc",
        default_qty: 1,
        is_worn: 0,
        is_consumable: 0,
        recommendation_set_id: null,
        sort_order: (curr[curr.length - 1]?.sort_order ?? 0) + 10,
      },
    ]);
  }

  function removeSelected() {
    setSaved(false);
    setRows((curr) => curr.filter((r) => !sel.includes(r._k)));
    setSel([]);
  }

  async function save() {
    setErr(null);
    setSaved(false);
    try {
      const cleaned = rows
        .filter((it) => it.name.trim())
        .map((it, idx) => ({
          name: it.name.trim(),
          description: it.description ?? null,
          category: it.category.trim() || "Misc",
          default_qty: it.default_qty,
          is_worn: !!it.is_worn,
          is_consumable: !!it.is_consumable,
          recommendation_set_id: it.recommendation_set_id ?? null,
          sort_order: it.sort_order ?? idx * 10,
        }));
      // The backend ignores id/template_id/match_key when creating; send the
      // editable subset only.
      const updated = await api.publishTemplate(eventType, {
        name: name.trim() || EVENT_TYPE_LABELS[eventType],
        items: cleaned as unknown as TemplateBundle["items"],
      });
      setBundle(updated);
      setRows(updated.items.map(({ id, template_id, match_key, ...rest }) => ({ ...rest, _k: key() })));
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (err && !bundle) return <EmptyState>{err}</EmptyState>;
  if (!bundle) return <EmptyState>Loading…</EmptyState>;

  const yesNo = [
    { value: "1", label: "Yes" },
    { value: "0", label: "No" },
  ];
  // Sets → select options; "" is the explicit "no suggestion" choice.
  const setNameById = new Map(catalog.map((b) => [b.set.id, b.set.name]));
  const setOptions = [
    { value: "", label: "— none —" },
    ...catalog.map((b) => ({ value: b.set.id, label: b.set.name })),
  ];
  const columns: Column<Row>[] = [
    { key: "name", header: "Name", editor: "text", value: (r) => r.name,
      render: (r) => r.name || <span className="t10-sub">unnamed</span> },
    { key: "category", header: "Category", editor: "text", value: (r) => r.category },
    { key: "default_qty", header: "Qty", align: "right", editor: "number",
      value: (r) => r.default_qty, render: (r) => <span className="t10-num">{r.default_qty}</span> },
    { key: "is_worn", header: "Worn", editor: "select", value: (r) => String(r.is_worn), options: yesNo,
      render: (r) => (r.is_worn ? statusCell("Worn", "neutral") : <span className="t10-sub">—</span>) },
    { key: "is_consumable", header: "Consumable", editor: "select", value: (r) => String(r.is_consumable), options: yesNo,
      render: (r) => (r.is_consumable ? statusCell("Consumable", "neutral") : <span className="t10-sub">—</span>) },
    { key: "recommendation_set_id", header: "Suggested", editor: "select",
      value: (r) => r.recommendation_set_id ?? "", options: setOptions,
      render: (r) =>
        r.recommendation_set_id
          ? <span>{setNameById.get(r.recommendation_set_id) ?? "linked"}</span>
          : <span className="t10-sub">—</span> },
  ];

  return (
    <div className="sp-page">
      <Toolbar>
        <Field label="Event type">
          <select value={eventType} onChange={(e) => setEventType(e.target.value as EventType)}>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </Field>
        <Field label="Template name">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <ToolbarSpacer />
        <Button onClick={addRow}>+ Row</Button>
        {saved && <StatusPill tone="ok">Saved</StatusPill>}
        <Button variant="primary" onClick={save}>Publish new version</Button>
      </Toolbar>

      {err && <p className="sp-error">{err}</p>}

      <DataTable
        rows={rows}
        rowKey={(r) => r._k}
        canEdit
        onCellCommit={commit}
        columns={columns}
        selectable
        selection={sel}
        onSelectionChange={setSel}
        bulkActions={() => (
          <Button variant="danger" onClick={removeSelected}>
            Remove {sel.length} item{sel.length === 1 ? "" : "s"}
          </Button>
        )}
        emptyLabel="No items — add a row to start the template."
        footer={<DataTable.Stat label="Items" value={rows.length} />}
      />
    </div>
  );
}

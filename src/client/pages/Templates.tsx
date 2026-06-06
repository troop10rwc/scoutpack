import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { EVENT_TYPES, EVENT_TYPE_LABELS, type EventType } from "../../shared/constants.ts";
import type { TemplateBundle, TemplateItem } from "../../shared/types.ts";

type DraftItem = Omit<TemplateItem, "id" | "template_id" | "match_key">;

export function Templates() {
  const [eventType, setEventType] = useState<EventType>("backpacking");
  const [bundle, setBundle] = useState<TemplateBundle | null>(null);
  const [name, setName] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setBundle(null);
    setSaved(false);
    api.getTemplate(eventType)
      .then((b) => {
        setBundle(b);
        setName(b.template.name);
        setItems(b.items.map(({ id, template_id, match_key, ...rest }) => rest));
      })
      .catch((e: Error) => setErr(e.message));
  }, [eventType]);

  function updateItem(i: number, patch: Partial<DraftItem>) {
    setItems((curr) => curr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addRow() {
    setItems((curr) => [
      ...curr,
      {
        name: "",
        description: null,
        category: "Misc",
        default_qty: 1,
        is_worn: 0,
        is_consumable: 0,
        sort_order: (curr[curr.length - 1]?.sort_order ?? 0) + 10,
      },
    ]);
  }
  function removeRow(i: number) {
    setItems((curr) => curr.filter((_, idx) => idx !== i));
  }
  async function save() {
    setErr(null);
    setSaved(false);
    try {
      const cleaned = items
        .filter((it) => it.name.trim())
        .map((it, idx) => ({
          name: it.name.trim(),
          description: it.description ?? null,
          category: it.category.trim() || "Misc",
          default_qty: it.default_qty,
          is_worn: !!it.is_worn,
          is_consumable: !!it.is_consumable,
          sort_order: it.sort_order ?? idx * 10,
        }));
      // The publishTemplate API expects items: TemplateItem[] shape; the
      // backend ignores id/template_id/match_key fields when creating, so we
      // just send the editable subset.
      const updated = await api.publishTemplate(eventType, {
        name: name.trim() || EVENT_TYPE_LABELS[eventType],
        items: cleaned as unknown as TemplateBundle["items"],
      });
      setBundle(updated);
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (err) return <div className="error">{err}</div>;
  if (!bundle) return <div className="loading">Loading…</div>;

  return (
    <div className="templates">
      <h1>Templates</h1>
      <div className="row">
        <label>
          Event type:{" "}
          <select value={eventType} onChange={(e) => setEventType(e.target.value as EventType)}>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>
        <label>
          Name:{" "}
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Qty</th>
            <th>Worn</th>
            <th>Consumable</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td>
                <input value={it.name} onChange={(e) => updateItem(i, { name: e.target.value })} />
              </td>
              <td>
                <input
                  value={it.category}
                  onChange={(e) => updateItem(i, { category: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={1}
                  value={it.default_qty}
                  onChange={(e) => updateItem(i, { default_qty: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={!!it.is_worn}
                  onChange={(e) => updateItem(i, { is_worn: e.target.checked ? 1 : 0 })}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={!!it.is_consumable}
                  onChange={(e) => updateItem(i, { is_consumable: e.target.checked ? 1 : 0 })}
                />
              </td>
              <td>
                <button onClick={() => removeRow(i)}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <button onClick={addRow}>+ row</button>
        <button onClick={save}>Publish new active version</button>
        {saved && <span className="saved">Saved.</span>}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { ClosetItem, Scout } from "../../shared/types.ts";

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

export function Closet({ scout }: { scout: Scout }) {
  const [items, setItems] = useState<ClosetItem[] | null>(null);
  const [draft, setDraft] = useState<Partial<ClosetItem>>(BLANK);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setItems(null);
    api.listCloset(scout.id).then(setItems).catch((e: Error) => setErr(e.message));
  }, [scout.id]);

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
      <h1>{scout.display_name}'s closet</h1>

      <section className="add-item">
        <h2>Add item</h2>
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

      {[...byCategory.entries()].map(([cat, list]) => {
        const totalGrams = list.reduce(
          (acc, it) => acc + (it.weight_grams ?? 0) * it.quantity,
          0,
        );
        return (
          <section key={cat} className="category">
            <h2>
              {cat} <small>{(totalGrams / 1000).toFixed(2)} kg</small>
            </h2>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Brand</th>
                  <th>Weight</th>
                  <th>Qty</th>
                  <th>Flags</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((it) => (
                  <tr key={it.id}>
                    <td>{it.name}</td>
                    <td>{it.brand ?? ""}</td>
                    <td>{it.weight_grams ? `${it.weight_grams} g` : ""}</td>
                    <td>{it.quantity}</td>
                    <td>
                      {it.is_worn ? "worn " : ""}
                      {it.is_consumable ? "consumable" : ""}
                    </td>
                    <td>
                      <button onClick={() => remove(it.id)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      {!items.length && <p className="empty">No items yet. Add gear you own above.</p>}
    </div>
  );
}

import { useEffect, useState } from "react";
import { Button, EmptyState, StatusPill } from "@troop10rwc/ui";
import { api } from "../api.ts";
import { usePageChrome } from "../chrome.tsx";
import { fmtPrice } from "./RecommendedGear.tsx";
import type { Scout, WishlistItem } from "../../shared/types.ts";

export function Wishlist({ scout }: { scout: Scout }) {
  const [items, setItems] = useState<WishlistItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Transient "moved to closet" confirmation, keyed by the removed item name.
  const [justGot, setJustGot] = useState<string | null>(null);

  usePageChrome(
    {
      title: `${scout.display_name}'s wishlist`,
      subtitle: `${items?.length ?? 0} item${items?.length === 1 ? "" : "s"} to buy`,
    },
    [scout.display_name, items?.length],
  );

  useEffect(() => {
    setItems(null);
    api.listWishlist(scout.id).then(setItems).catch((e: Error) => setErr(e.message));
  }, [scout.id]);

  async function got(item: WishlistItem) {
    try {
      await api.fulfillWishlist(scout.id, item.id);
      setItems((list) => (list ?? []).filter((i) => i.id !== item.id));
      setJustGot(item.name);
      setTimeout(() => setJustGot((n) => (n === item.name ? null : n)), 4000);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function remove(item: WishlistItem) {
    if (!confirm(`Remove “${item.name}” from the wishlist?`)) return;
    try {
      await api.removeWishlist(scout.id, item.id);
      setItems((list) => (list ?? []).filter((i) => i.id !== item.id));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (err && !items) return <EmptyState>{err}</EmptyState>;
  if (!items) return <EmptyState>Loading wishlist…</EmptyState>;

  if (!items.length) {
    return (
      <div className="sp-page sp-wishlist">
        {justGot && (
          <p className="sp-wishlist__got">
            <StatusPill tone="ok">Added to closet</StatusPill> “{justGot}” is now in {scout.display_name}
            ’s closet.
          </p>
        )}
        <EmptyState>
          Nothing on the wishlist yet. Browse Recommended Gear from the Closet, or add items from a
          packing list’s missing rows.
        </EmptyState>
      </div>
    );
  }

  // Group by category, mirroring the closet/packing layout.
  const byCat = new Map<string, WishlistItem[]>();
  for (const it of items) {
    const arr = byCat.get(it.category) ?? [];
    arr.push(it);
    byCat.set(it.category, arr);
  }
  const cats = [...byCat.keys()].sort((a, b) => a.localeCompare(b));

  return (
    <div className="sp-page sp-wishlist">
      {err && <p className="sp-error">{err}</p>}
      {justGot && (
        <p className="sp-wishlist__got">
          <StatusPill tone="ok">Added to closet</StatusPill> “{justGot}” is now in{" "}
          {scout.display_name}’s closet.
        </p>
      )}
      <p className="t10-sub sp-wishlist__hint">
        Hand this list to a parent. When something’s bought, hit <strong>Got it</strong> to move it
        into the closet.
      </p>

      {cats.map((cat) => (
        <section key={cat} className="sp-cat">
          <h2 className="sp-cat__head">{cat}</h2>
          <ul className="sp-wishcards">
            {(byCat.get(cat) ?? []).map((it) => (
              <li key={it.id} className="sp-wishcard">
                <div className="sp-wishcard__main">
                  {it.pick_label && <span className="sp-wishcard__tag">{it.pick_label}</span>}
                  <span className="sp-wishcard__name">{it.name}</span>
                  {it.brand && <span className="t10-sub"> · {it.brand}</span>}
                  {it.description && <p className="sp-wishcard__desc">{it.description}</p>}
                  {it.options.length > 0 ? (
                    <ul className="sp-wishcard__opts">
                      {it.options.map((o) => (
                        <li key={o.id} className="sp-wishcard__opt">
                          <span className="sp-wishcard__vendor">{o.vendor}</span>
                          <span className="t10-num">{fmtPrice(o.price_cents)}</span>
                          {o.note && <span className="t10-sub">{o.note}</span>}
                          {o.url && (
                            <a href={o.url} target="_blank" rel="noreferrer" className="sp-wishcard__buy">
                              Buy ↗
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="t10-sub sp-wishcard__noopts">No buy links yet.</p>
                  )}
                </div>
                <div className="sp-wishcard__acts">
                  <Button size="sm" variant="primary" onClick={() => got(it)}>
                    Got it
                  </Button>
                  <button
                    className="sp-iconbtn sp-iconbtn--del"
                    title="Remove from wishlist"
                    onClick={() => remove(it)}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

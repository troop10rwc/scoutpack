import { useState } from "react";

// Distinct categorical palette for the weight charts (closet legend swatches +
// section heads, the event stacked bar), keyed by the category's alphabetical
// position. This is data-viz: a chart legitimately needs N distinguishable hues,
// which no single semantic token provides.
export const PALETTE = [
  "#4f86c6", "#e8833a", "#cc3333", "#e0c020", "#a8d24a",
  "#4f9d3a", "#7e3ff2", "#39a0a0", "#d23a8a", "#9c6b3f",
  "#3a6ed2", "#7a7a7a",
];

// A category's chart color, stable across weight changes (keyed off its slot in
// the sorted category list, not its weight share).
export const colorForCategory = (cat: string, categories: string[]) =>
  PALETTE[Math.max(0, categories.indexOf(cat)) % PALETTE.length];

export type WeightSegment = {
  category: string;
  color: string;
  value: number; // total weight of the category, in grams
  // Itemized lines (already weight-of-quantity) shown in the hover breakdown.
  items: { name: string; weight: number }[];
};

// Full-width horizontal stacked bar: one segment per category, sized by its
// share of the total weight. Hovering (or focusing) a segment reveals an
// itemized weight breakdown for that category.
export function WeightBar({
  segments,
  fmt,
}: {
  segments: WeightSegment[];
  fmt: (grams: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const segs = segments.filter((s) => s.value > 0);
  const total = segs.reduce((a, s) => a + s.value, 0);
  if (total === 0) return null;

  // Running offset → each segment's center (%), used to decide which way its
  // tooltip hangs so it never runs off the page edge.
  let acc = 0;
  const placed = segs.map((s) => {
    const start = acc;
    const pct = (s.value / total) * 100;
    acc += pct;
    const center = start + pct / 2;
    const align = center < 25 ? "start" : center > 75 ? "end" : "center";
    return { ...s, pct, center, align };
  });

  return (
    <div
      className="sp-wbar"
      role="img"
      aria-label={`Total weight ${fmt(total)}: ${placed
        .map((s) => `${s.category} ${fmt(s.value)}`)
        .join(", ")}`}
    >
      <div className="sp-wbar__track">
        {placed.map((s, i) => (
          <div
            key={s.category}
            className="sp-wbar__seg"
            style={{ flexGrow: s.value, background: s.color }}
            tabIndex={0}
            aria-label={`${s.category}: ${fmt(s.value)}`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive((a) => (a === i ? null : a))}
            onFocus={() => setActive(i)}
            onBlur={() => setActive((a) => (a === i ? null : a))}
          >
            {s.pct >= 8 && <span className="sp-wbar__seglabel">{s.category}</span>}
          </div>
        ))}
      </div>
      {active != null &&
        (() => {
          const s = placed[active];
          const style =
            s.align === "start"
              ? { left: 0 }
              : s.align === "end"
                ? { right: 0 }
                : { left: `${s.center}%`, transform: "translateX(-50%)" };
          return (
            <div className="sp-wbar__tip" style={style} role="tooltip">
              <div className="sp-wbar__tiphead">
                <span className="sp-swatch" style={{ background: s.color }} />
                <span className="sp-wbar__tipname">{s.category}</span>
                <span className="t10-num">{fmt(s.value)}</span>
              </div>
              <table className="sp-wbar__tiptable">
                <tbody>
                  {s.items.map((it, j) => (
                    <tr key={j}>
                      <td>{it.name}</td>
                      <td className="is-right t10-num">{fmt(it.weight)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
    </div>
  );
}

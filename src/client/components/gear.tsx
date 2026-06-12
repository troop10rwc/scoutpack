import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { EVENT_TYPES, EVENT_TYPE_LABELS } from "../../shared/constants.ts";

// One autocomplete suggestion: a distinct item name and the templates that
// include it (e.g. "sleeping bag" → ["Backpacking", "Car Camping"]).
export type NameSuggestion = { name: string; templates: string[] };

// Load the name autocomplete from every published template: group items by name
// and remember which templates (by event type) each one appears in. Shared by
// the closet and packing-list editors so both steer toward canonical names.
export function useTemplateSuggestions(): NameSuggestion[] {
  const [suggestions, setSuggestions] = useState<NameSuggestion[]>([]);
  useEffect(() => {
    let live = true;
    Promise.all(EVENT_TYPES.map((t) => api.getTemplate(t).catch(() => null))).then(
      (bundles) => {
        if (!live) return;
        const byName = new Map<string, NameSuggestion>();
        for (const b of bundles) {
          if (!b) continue;
          // Label by event type ("Backpacking", "Car Camping"), not the raw
          // template name (which carries a "— standard" variant suffix).
          const label = EVENT_TYPE_LABELS[b.template.event_type];
          for (const it of b.items) {
            const name = it.name.trim();
            if (!name) continue;
            const entry = byName.get(name.toLowerCase()) ?? { name, templates: [] };
            if (!entry.templates.includes(label)) entry.templates.push(label);
            byName.set(name.toLowerCase(), entry);
          }
        }
        setSuggestions([...byName.values()].sort((a, b) => a.name.localeCompare(b.name)));
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return suggestions;
}

// Inline gear glyphs (camera / link / worn / consumable / favorite). Shared so
// the closet and packing-list rows render the same iconography.
export function Icon({ name, filled }: { name: string; filled?: boolean }) {
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
    case "closet":
      // A wardrobe: two doors with knobs — the "is it in your closet?" glyph.
      return (
        <svg {...p}>
          <rect x="5" y="3" width="14" height="18" rx="1" />
          <line x1="12" y1="3" x2="12" y2="21" />
          <line x1="9.4" y1="11" x2="9.4" y2="13" />
          <line x1="14.6" y1="11" x2="14.6" y2="13" />
        </svg>
      );
    default:
      return null;
  }
}

// Name cell with a template-driven autocomplete. Typing filters the suggestion
// list; each row shows the full item name and the templates it belongs to.
export function NameInput({
  value,
  suggestions,
  autoFocus,
  onChange,
  onCommit,
}: {
  value: string;
  suggestions: NameSuggestion[];
  autoFocus?: boolean;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Anchor coords for the dropdown. It's rendered position:fixed so it can
  // escape the table's overflow:auto clipping; we track the input's rect here.
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [autoFocus]);

  const q = value.trim().toLowerCase();
  const matches = q
    ? suggestions.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8)
    : [];

  // Keep the fixed dropdown glued to the input as the page/table scrolls.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, value]);

  function pick(s: NameSuggestion) {
    onChange(s.name);
    onCommit(s.name);
    setOpen(false);
  }

  return (
    <div className="sp-nameac">
      <input
        ref={ref}
        className="sp-cell"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          // Delay so an option's onMouseDown can fire before the list unmounts.
          setTimeout(() => setOpen(false), 120);
          onCommit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (!open || !matches.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 && pos && (
        <ul
          className="sp-ac"
          role="listbox"
          style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
        >
          {matches.map((s, i) => (
            <li
              key={s.name}
              role="option"
              aria-selected={i === active}
              className={i === active ? "is-active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="sp-ac__name">{s.name}</span>
              <span className="sp-ac__tpl">{s.templates.join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// One selectable recommendation set: stable id + the name shown/typed.
export type SetOption = { id: string; name: string };

// Autocomplete for linking a template item to a recommendation set. Unlike a
// <select>, you filter by typing; clearing the field (or backing out an exact
// match) unlinks the row. Commits the matched set id, or null when empty.
export function SetInput({
  value,
  options,
  onChange,
}: {
  // The currently linked set id, or null when none.
  value: string | null;
  options: SetOption[];
  onChange: (id: string | null) => void;
}) {
  // Local text mirrors the linked set's name; reset whenever the row's value or
  // the option set changes (e.g. switching event types reloads the catalog).
  const linkedName = options.find((o) => o.id === value)?.name ?? "";
  const [text, setText] = useState(linkedName);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(linkedName);
  }, [linkedName]);

  const q = text.trim().toLowerCase();
  const matches = q
    ? options.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 8)
    : options.slice(0, 8);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, text]);

  function pick(o: SetOption) {
    setText(o.name);
    onChange(o.id);
    setOpen(false);
  }

  // On blur, snap the field back to the linked set's name and commit: an exact
  // (case-insensitive) name match links that set; an empty field unlinks.
  function commitText() {
    const t = text.trim();
    if (!t) {
      onChange(null);
      return;
    }
    const exact = options.find((o) => o.name.toLowerCase() === t.toLowerCase());
    if (exact) onChange(exact.id);
    else setText(linkedName);
  }

  return (
    <div className="sp-nameac">
      <input
        ref={ref}
        className="sp-cell"
        value={text}
        placeholder="— none —"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 120);
          commitText();
        }}
        onKeyDown={(e) => {
          if (!open || !matches.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 && pos && (
        <ul
          className="sp-ac"
          role="listbox"
          style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
        >
          {matches.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? "is-active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="sp-ac__name">{o.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

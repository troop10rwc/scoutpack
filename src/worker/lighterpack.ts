// Fetching and parsing of LighterPack share CSVs. LighterPack exposes a public
// CSV for any pack at https://lighterpack.com/csv/:id with the columns:
//   Item Name,Category,desc,qty,weight,unit,url,price,worn,consumable
// We map those onto the closet's item shape (description carries the brand/model
// blurb; weights are normalized to grams).

// Thrown for user-correctable problems (bad URL, unreachable CSV, empty file).
// `status` is read by the route's handleError() to return a 400 rather than 500.
export class ImportError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

export interface ParsedImportItem {
  name: string;
  category: string;
  description: string | null;
  weight_grams: number | null;
  quantity: number;
  is_worn: boolean;
  is_consumable: boolean;
}

// Accepts a full LighterPack URL (share page /r/:id or raw /csv/:id) or a bare
// pack id, and returns the canonical CSV URL. Restricted to lighterpack.com so
// this endpoint can't be used to fetch arbitrary hosts via the Worker.
export function lighterpackCsvUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new ImportError("Enter a LighterPack URL");

  // Bare pack id, e.g. "2ysfob".
  if (/^[A-Za-z0-9_-]+$/.test(raw)) return `https://lighterpack.com/csv/${raw}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImportError("Enter a valid LighterPack URL");
  }
  const host = url.hostname.toLowerCase();
  if (host !== "lighterpack.com" && !host.endsWith(".lighterpack.com")) {
    throw new ImportError("Only lighterpack.com URLs can be imported");
  }
  const m = url.pathname.match(/^\/(?:csv|r)\/([A-Za-z0-9_-]+)/);
  if (!m) throw new ImportError("That doesn't look like a LighterPack share link");
  return `https://lighterpack.com/csv/${m[1]}`;
}

// Minimal RFC 4180 CSV parser: handles quoted fields, escaped quotes (""),
// embedded commas/newlines, and CRLF. Returns rows of string cells.
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (ch === "\r") {
      i++;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toGrams(value: number, unit: string): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const u = unit.trim().toLowerCase();
  const factor =
    u === "oz" || u === "ounce" || u === "ounces"
      ? 28.3495
      : u === "lb" || u === "lbs" || u === "pound" || u === "pounds"
        ? 453.592
        : u === "kg" || u === "kilogram" || u === "kilograms"
          ? 1000
          : 1; // g / gram / grams / blank / unknown → treat as grams
  return Math.round(value * factor);
}

// LighterPack marks these columns with the literal words "Worn"/"Consumable"
// (other exports use 1/true/yes/x). Treat any non-empty, non-zero value as set.
function truthy(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s !== "" && s !== "0" && s !== "false" && s !== "no";
}

// Map header names (case-insensitive) to column indices, so we tolerate column
// reordering and only depend on the names LighterPack emits.
function columnIndex(header: string[]): {
  name: number;
  category: number;
  desc: number;
  qty: number;
  weight: number;
  unit: number;
  worn: number;
  consumable: number;
} {
  const at = (...names: string[]) => {
    for (const n of names) {
      const idx = header.findIndex((h) => h.trim().toLowerCase() === n);
      if (idx !== -1) return idx;
    }
    return -1;
  };
  return {
    name: at("item name", "name", "item"),
    category: at("category"),
    desc: at("desc", "description"),
    qty: at("qty", "quantity"),
    weight: at("weight"),
    unit: at("unit"),
    worn: at("worn"),
    consumable: at("consumable"),
  };
}

export function parseLighterpackCsv(text: string): ParsedImportItem[] {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return [];
  const cols = columnIndex(rows[0]);
  if (cols.name === -1) {
    throw new ImportError("CSV is missing an 'Item Name' column");
  }
  const cell = (row: string[], idx: number) => (idx >= 0 ? (row[idx] ?? "").trim() : "");

  const items: ParsedImportItem[] = [];
  for (const row of rows.slice(1)) {
    const name = cell(row, cols.name);
    if (!name) continue; // skip blank / spacer rows
    const qty = parseInt(cell(row, cols.qty), 10);
    const weight = parseFloat(cell(row, cols.weight));
    items.push({
      name,
      category: cell(row, cols.category) || "Misc",
      description: cell(row, cols.desc) || null,
      weight_grams: toGrams(weight, cell(row, cols.unit)),
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      is_worn: truthy(cell(row, cols.worn)),
      is_consumable: truthy(cell(row, cols.consumable)),
    });
  }
  return items;
}

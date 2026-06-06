// Normalize a free-text gear name into a stable match_key used to auto-link
// template items to closet items. "Sleeping Bag" / "sleeping-bag" / "Sleeping
// bag (down)" all collapse to "sleeping_bag".
export function matchKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")        // strip combining marks
    .replace(/\([^)]*\)/g, " ")             // drop parenthetical qualifiers
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

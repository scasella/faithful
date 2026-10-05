// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[["c","a","b","a"]]]
// Round 4 (arrays): plain sort on a string literal union array.
export function r4SortLiteralUnionStrings(xs: ("b" | "a" | "c")[]): string[] {
  return xs.slice().sort();
}

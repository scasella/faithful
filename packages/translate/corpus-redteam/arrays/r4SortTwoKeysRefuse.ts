// @redteam status=held
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[[{"x":1,"y":2}]]]
// Round 4 (arrays): two-key comparator (a lexicographic order the key reader does not model).
export function r4SortTwoKeysRefuse(rs: { x: number; y: number }[]): { x: number; y: number }[] {
  return rs.slice().sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
}

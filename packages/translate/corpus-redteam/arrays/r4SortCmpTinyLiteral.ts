// @redteam status=held
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[[3,1,2]]]
// Round 4 (arrays): -1e-400 is -0 in JS: the comparator does not order a < b.
export function r4SortCmpTinyLiteral(xs: number[]): number[] {
  return xs.slice().sort((a, b) => (a < b ? -1e-400 : a > b ? 1 : 0));
}

// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[3,1,2]]]
// Round 4 (arrays): numeric separators in comparator literals.
export function r4SortCmpSeparatorLiteral(xs: number[]): number[] {
  return xs.slice().sort((a, b) => (a < b ? -1_0 : a > b ? 1_0 : 0));
}

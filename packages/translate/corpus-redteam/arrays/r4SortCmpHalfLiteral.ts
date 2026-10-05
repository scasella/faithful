// @redteam status=held
// @redteam expect=refuse code=float
// @redteam inputs=[[[3,1,2]]]
// Round 4 (arrays): non-integer sign literals in a comparator.
export function r4SortCmpHalfLiteral(xs: number[]): number[] {
  return xs.slice().sort((a, b) => (a < b ? -0.5 : a > b ? 0.5 : 0));
}

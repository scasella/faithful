// @redteam status=held
// @redteam expect=refuse code=float
// @redteam inputs=[[[3,1,2,1]],[[]]]
// Round 4 (arrays): comparator returns -Infinity / Infinity literals.
export function r4SortCmpInfLiteral(xs: number[]): number[] {
  return xs.slice().sort((a, b) => (a < b ? -1e400 : a > b ? 1e400 : 0));
}

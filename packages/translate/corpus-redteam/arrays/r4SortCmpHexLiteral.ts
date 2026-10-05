// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[3,1,2]]]
// Round 4 (arrays): hex literals, descending.
export function r4SortCmpHexLiteral(xs: number[]): number[] {
  return xs.slice().sort((a, b) => (a < b ? 0x1 : a > b ? -0x1 : 0x0));
}

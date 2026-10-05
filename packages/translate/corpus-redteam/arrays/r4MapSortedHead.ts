// @redteam status=held
// @redteam expect=refuse code=missing-annotation
// @redteam inputs=[[[[3,1],[2]]],[[[3],[]]]]
// Round 4 (arrays): index into a sorted fresh copy inside a callback (out of range on an empty row).
export function r4MapSortedHead(xss: number[][]): number[] {
  return xss.map((r) => r.concat([]).sort((a, b) => a - b)[0]);
}

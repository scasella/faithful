// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[[3,1],[2]]],[[[3],[]]],[[[5,-5,0]]]]
// Round 4 (arrays): index 0 of a sorted fresh copy (slice) inside a map callback; out of range on an empty row.
export function r4MapSortedSliceHead(xss: number[][]): number[] {
  return xss.map((r) => r.slice().sort((a, b) => a - b)[0]);
}

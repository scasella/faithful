// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[[1,2],[3]]],[[[1,2,3]]],[[]]]
// Round 4 (arrays): inner callback index shadows the outer one.
export function r4NestedShadowIndex(xss: number[][]): number[][] {
  return xss.map((row, i) => row.map((x, i) => x + i + xss[i].length));
}

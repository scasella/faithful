// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[[1],[2,3]]],[[[1],[]]],[[]]]
export function heads(xss: number[][]): number[] {
  return xss.map((r) => r[0]);
}

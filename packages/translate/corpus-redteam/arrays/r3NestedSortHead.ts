// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[[3,1],[2]]],[[[1],[]]],[[]]]
export function mins(xss: number[][]): number[] {
  return xss.map((r) => r.slice().sort((a, b) => a - b)[0]);
}

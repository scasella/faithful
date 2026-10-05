// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[[1,2],[3]]],[[]],[[[],[4,5,6]]]]
export function grid(xss: number[][]): number[][] {
  return xss.map((r, i) => r.map((x, j) => x * 10 + i - j + xss[i].length));
}

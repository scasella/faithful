// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[[1],[2,3]]],[[]]]
export function crl(xss: number[][]): number {
  const e: number[] = [];
  const all = [[0]].concat(xss, [e]);
  return all.length * 100 + all[all.length - 1].length * 10 + all[0][0];
}

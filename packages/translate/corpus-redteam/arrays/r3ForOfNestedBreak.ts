// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[[1,2],[3,-1,4],[5]]],[[]],[[[-1]]]]
export function nb(xss: number[][]): number {
  let s = 0;
  for (const r of xss) {
    for (const x of r) {
      if (x < 0) break;
      s = s * 10 + x;
    }
    s = s + 1;
  }
  return s;
}

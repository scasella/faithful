// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[[1,2],[],[3]]],[[]]]
export function flatSum(g: number[][]): number {
  let s = 0;
  for (const row of g) {
    for (const v of row) {
      s = s * 2 + v;
    }
  }
  return s;
}

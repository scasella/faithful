// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[[2,3],[-4,5],[0,9]]],[[]]]
export function dot(ps: [number, number][]): number {
  let s = 0;
  for (const p of ps) {
    s = s + p[0] * p[1];
  }
  return s;
}

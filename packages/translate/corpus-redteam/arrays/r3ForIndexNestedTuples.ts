// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[[1,[2,3]],[4,[5,6]]]],[[]]]
export function sumNested(ps: Array<[number, [number, number]]>): number {
  let s = 0;
  for (let i = 0; i < ps.length; i++) {
    s = s + ps[i][0] * 100 + ps[i][1][0] * 10 + ps[i][1][1];
  }
  return s;
}

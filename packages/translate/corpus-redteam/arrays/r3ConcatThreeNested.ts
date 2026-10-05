// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[[1]],[[]],[[2,3]]],[[],[],[]]]
export function c3(a: number[][], b: number[][], c: number[][]): number[][] {
  return a.concat(b, c, a.slice(1), [[9]]);
}

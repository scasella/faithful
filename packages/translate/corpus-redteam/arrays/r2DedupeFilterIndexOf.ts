// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[3,1,3,2,1,3]],[[]],[[0,0]]]
export function dedupe(xs: number[]): number[] {
  return xs.filter((x, i) => xs.indexOf(x) === i);
}

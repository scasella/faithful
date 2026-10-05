// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,5,2]],[[]],[[7]]]
export function deltas(xs: number[]): number[] {
  return xs.map((x, i) => (i + 1 < xs.length ? xs[i + 1] - x : 0));
}

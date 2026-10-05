// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[3,1,2,3]],[[]]]
// Round 4 (arrays): concat() with no arguments as the fresh sort receiver; the parameter must stay unsorted.
export function r4ConcatZeroArgSort(xs: number[]): number[] {
  const ys = xs.concat().sort((a, b) => b - a);
  return ys.concat(xs);
}

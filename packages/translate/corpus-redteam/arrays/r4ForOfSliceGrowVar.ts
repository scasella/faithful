// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3]],[[]]]
// Round 4 (arrays): for...of over a slice while the sliced variable grows.
export function r4ForOfSliceGrowVar(xs: number[]): number[] {
  for (const x of xs.slice(1)) {
    xs = xs.concat([x * 10]);
  }
  return xs;
}

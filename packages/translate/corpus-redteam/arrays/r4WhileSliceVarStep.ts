// @redteam status=held
// @redteam expect=refuse code=no-termination-measure
// @redteam inputs=[[[1,2,3],2],[[1,2,3],0],[[1,2,3],-4]]
// Round 4 (arrays): shrinking while with a non-literal step >= 1.
export function r4WhileSliceVarStep(xs: number[], n: number): number {
  const k = Math.max(1, n);
  let c = 0;
  while (xs.length > 0) {
    xs = xs.slice(k);
    c = c + 1;
  }
  return c;
}

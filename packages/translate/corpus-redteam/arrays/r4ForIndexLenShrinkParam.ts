// @redteam status=held
// @redteam expect=refuse code=no-termination-measure
// @redteam inputs=[[[1,2,3,4,5]],[[]],[[7]]]
// Round 4 (arrays): for-loop bound xs.length shrinks because the body reassigns the parameter.
export function r4ForIndexLenShrinkParam(xs: number[]): number {
  let c = 0;
  for (let i = 0; i < xs.length; i++) {
    xs = xs.slice(1);
    c = c + 1;
  }
  return c;
}

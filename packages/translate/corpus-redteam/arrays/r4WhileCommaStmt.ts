// @redteam status=held
// @redteam expect=refuse code=no-termination-measure
// @redteam inputs=[[[1,2,3]],[[]],[[5]]]
// Round 4 (arrays): comma expression statement: update of the measure, then a read of the new value.
export function r4WhileCommaStmt(xs: number[]): number {
  let s = 0;
  while (xs.length > 0) {
    xs = xs.slice(1), s = s + (xs.length > 0 ? xs[0] : 100);
  }
  return s;
}

// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[3,1,2]],[[]]]
// Round 4 (arrays): unannotated [] as the reduce initial value, contextually typed by the callback.
export function r4ReduceEmptyLiteralInit(xs: number[]): number[] {
  return xs.reduce((acc: number[], x) => [x].concat(acc), []);
}

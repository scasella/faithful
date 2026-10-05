// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2],1],[[1,2],5],[[],0],[[4],-1]]
// Round 4 (arrays): out-of-range read is undefined in JS (= none) but excluded by rangeOk.
export function r4OptionReturnIndex(xs: number[], i: number): number | undefined {
  return xs[i];
}

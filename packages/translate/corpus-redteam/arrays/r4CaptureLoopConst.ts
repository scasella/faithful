// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2],3],[[],2],[[5],0]]
// Round 4 (arrays): callback captures a per-iteration const derived from the loop counter.
export function r4CaptureLoopConst(xs: number[], n: number): number[] {
  let out: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = i;
    out = out.concat(xs.map((x) => x * k));
  }
  return out;
}

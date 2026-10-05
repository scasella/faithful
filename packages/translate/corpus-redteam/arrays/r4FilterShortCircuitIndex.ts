// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[0,3,1],[1,0]],[[-1],[1]],[[0,1],[5,-5]]]
// Round 4 (arrays): && short-circuit guards an index inside a filter callback.
export function r4FilterShortCircuitIndex(xs: number[], ys: number[]): number[] {
  return xs.filter((x) => x < ys.length && ys[x] > 0);
}

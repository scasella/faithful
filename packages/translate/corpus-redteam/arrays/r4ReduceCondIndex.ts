// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[1,7,-2,0],[10,20]],[[1],[5,6]]]
// Round 4 (arrays): conditional reduce body; untaken branch would index out of range.
export function r4ReduceCondIndex(xs: number[], ys: number[]): number {
  return xs.reduce((acc, x) => (x > 0 && x < ys.length ? acc + ys[x] : acc - x), 0);
}

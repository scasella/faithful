// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[0,5,-1],[7,8]],[[1],[]],[[1,0],[3,4]]]
// Round 4 (arrays): checked index only in the taken branch of a callback ternary.
export function r4MapTernaryIndex(xs: number[], ys: number[]): number[] {
  return xs.map((x) => (x >= 0 && x < ys.length ? ys[x] : -1));
}

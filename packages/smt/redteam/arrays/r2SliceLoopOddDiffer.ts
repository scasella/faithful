// @smt-redteam expect=differ bounds={"array":4,"string":1,"int":2}
// Round 2, as r2SliceLoopVsForOfEq but the candidate takes the odd positions.
export function original(xs: number[]): number {
  let ys = xs;
  let s = 0;
  while (ys.length > 0) {
    s = s * 3 + ys[0];
    ys = ys.slice(2);
  }
  return s;
}
export function candidate(xs: number[]): number {
  return xs.filter((x, i) => i % 2 === 1).reduce((a, x) => a * 3 + x, 0);
}

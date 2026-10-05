// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":2}
// Round 3: reversal by mapI over mirrored indices vs reduce with prepend.
export function original(xs: number[]): number[] {
  return xs.map((x, i) => xs[xs.length - 1 - i]);
}
export function candidate(xs: number[]): number[] {
  return xs.reduce((acc: number[], x) => [x].concat(acc), []);
}

// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":2}
// reduce with a record accumulator against two folds.
export function original(xs: number[]): number {
  const r = xs.reduce((acc, x) => ({ s: acc.s + x, n: acc.n + 1 }), { s: 0, n: 0 });
  return r.s * 10 + r.n;
}
export function candidate(xs: number[]): number {
  return xs.reduce((a, x) => a + x, 0) * 10 + xs.length;
}

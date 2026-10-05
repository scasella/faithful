// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":2}
// First element of the sorted copy is the minimum.
export function original(xs: number[]): number {
  return xs.slice().sort((a, b) => a - b)[0];
}
export function candidate(xs: number[]): number {
  return xs.reduce((m, x) => Math.min(m, x), xs[0]);
}

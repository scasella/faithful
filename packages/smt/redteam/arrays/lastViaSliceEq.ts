// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":2}
// Last element by index vs slice(-1)[0] (both out of bounds on []).
export function original(xs: number[]): number {
  return xs[xs.length - 1];
}
export function candidate(xs: number[]): number {
  return xs.slice(-1)[0];
}

// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":2}
// slice(-2, -1) is the second-to-last element when there is one.
export function original(xs: number[]): number[] {
  return xs.slice(-2, -1);
}
export function candidate(xs: number[]): number[] {
  return xs.length >= 2 ? [xs[xs.length - 2]] : [];
}

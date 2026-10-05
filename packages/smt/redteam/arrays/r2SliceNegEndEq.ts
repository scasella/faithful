// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":1}
// Round 2, literal negative end: slice(0, -1) vs slice(0, length - 1) (equal also for [], where both ends clamp to 0).
export function original(xs: number[]): number[] {
  return xs.slice(0, -1).concat(xs.slice(-1));
}
export function candidate(xs: number[]): number[] {
  return xs.slice(0, xs.length - 1).concat(xs.slice(xs.length - 1 < 0 ? 0 : xs.length - 1));
}

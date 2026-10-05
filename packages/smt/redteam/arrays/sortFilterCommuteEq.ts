// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":2}
// Sorting commutes with filtering.
export function original(xs: number[]): number[] {
  return xs.filter((x) => x > 0).sort((a, b) => a - b);
}
export function candidate(xs: number[]): number[] {
  return xs.slice().sort((a, b) => a - b).filter((x) => x > 0);
}

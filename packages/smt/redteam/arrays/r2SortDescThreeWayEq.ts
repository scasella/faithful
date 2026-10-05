// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":2}
// Round 2, descending sort written as a three-way conditional (with nested <= / ===) vs b - a.
export function original(xs: number[]): number[] {
  return xs.slice().sort((a, b) => (a <= b ? (a === b ? 0 : 1) : -1));
}
export function candidate(xs: number[]): number[] {
  return xs.slice().sort((a, b) => b - a);
}

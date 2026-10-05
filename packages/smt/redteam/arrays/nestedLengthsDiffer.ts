// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":1}
// Sum of inner lengths, off by one per non-empty row.
export function original(xs: number[][]): number {
  return xs.map((r) => r.length).reduce((a, b) => a + b, 0);
}
export function candidate(xs: number[][]): number {
  return xs.reduce((a, r) => a + (r.length > 0 ? r.length : 1), 0);
}

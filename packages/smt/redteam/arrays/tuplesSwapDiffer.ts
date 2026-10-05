// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":1}
// Arrays of tuples: a - b vs b - a.
export function original(ps: [number, number][]): number[] {
  return ps.map((p) => p[0] - p[1]);
}
export function candidate(ps: [number, number][]): number[] {
  return ps.map((p) => p[1] - p[0]);
}

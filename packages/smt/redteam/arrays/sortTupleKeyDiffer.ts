// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// Sort pairs by the second component vs by the first.
export function original(ps: [number, number][]): [number, number][] {
  return ps.slice().sort((a, b) => a[1] - b[1]);
}
export function candidate(ps: [number, number][]): [number, number][] {
  return ps.slice().sort((a, b) => a[0] - b[0]);
}

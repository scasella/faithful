// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":1}
// Round 3: reduce(max, 0) is not the maximum when every element is negative.
export function original(xs: number[]): number {
  return xs.reduce((m, x) => Math.max(m, x), 0);
}
export function candidate(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.slice().sort((a, b) => b - a)[0];
}

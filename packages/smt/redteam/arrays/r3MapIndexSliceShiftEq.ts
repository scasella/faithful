// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":2}
// Round 3: the index of map after slice(2) is shifted by 2 relative to map before slice(2).
export function original(xs: number[]): number[] {
  return xs.slice(2).map((x, i) => x + i);
}
export function candidate(xs: number[]): number[] {
  return xs.map((x, i) => x + i - 2).slice(2);
}

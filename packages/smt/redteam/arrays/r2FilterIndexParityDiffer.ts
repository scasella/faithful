// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":2}
// Round 2, filterI: index parity vs value parity.
export function original(xs: number[]): number[] {
  return xs.filter((x, i) => i % 2 === 0);
}
export function candidate(xs: number[]): number[] {
  return xs.filter((x, i) => x % 2 === 0);
}

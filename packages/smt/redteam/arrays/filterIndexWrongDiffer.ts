// @smt-redteam expect=differ bounds={"array":4,"string":1,"int":1}
// filterI on the original index vs filtering after a filter (indices shift).
export function original(xs: number[]): number[] {
  return xs.filter((x) => x !== 0).filter((x, i) => i % 2 === 0);
}
export function candidate(xs: number[]): number[] {
  return xs.filter((x, i) => i % 2 === 0).filter((x) => x !== 0);
}

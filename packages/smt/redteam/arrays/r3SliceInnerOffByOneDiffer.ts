// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// Round 3: off by one at the end: filterI(0 < i < length) keeps the last element, slice(1, -1) does not.
export function original(xs: number[]): number[] {
  return xs.slice(1, -1);
}
export function candidate(xs: number[]): number[] {
  return xs.filter((x, i) => i > 0 && i < xs.length);
}

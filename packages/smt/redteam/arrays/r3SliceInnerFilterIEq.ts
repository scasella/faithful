// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":1} adv=[[[1,2,3,4,5,6]],[[9]],[[]]]
// Round 3: xs.slice(1, -1) equals filterI(0 < i < length - 1), including lengths 0 and 1 (slice(1, 0) is empty).
export function original(xs: number[]): number[] {
  return xs.slice(1, -1);
}
export function candidate(xs: number[]): number[] {
  return xs.filter((x, i) => i > 0 && i < xs.length - 1);
}

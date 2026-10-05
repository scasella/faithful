// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// Round 2, slice(-3) vs slice(|length - 3|): equal for length 3, different for length 1 and 2.
export function original(xs: number[]): number[] {
  return xs.slice(-3);
}
export function candidate(xs: number[]): number[] {
  return xs.slice(Math.abs(xs.length - 3));
}

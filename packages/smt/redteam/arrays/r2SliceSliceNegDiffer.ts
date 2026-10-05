// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":2}
// Round 2, slice relIndex composition: xs.slice(a).slice(b) is not xs.slice(a + b) once a or b is negative.
export function original(xs: number[], a: number, b: number): number[] {
  return xs.slice(a).slice(b);
}
export function candidate(xs: number[], a: number, b: number): number[] {
  return xs.slice(a + b);
}

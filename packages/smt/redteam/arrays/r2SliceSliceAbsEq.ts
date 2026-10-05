// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":2}
// Round 2, slice: with non-negative starts, slicing twice equals slicing once by the sum (clamping at the length).
export function original(xs: number[], a: number, b: number): number[] {
  return xs.slice(Math.abs(a)).slice(Math.abs(b));
}
export function candidate(xs: number[], a: number, b: number): number[] {
  return xs.slice(Math.abs(a) + Math.abs(b));
}

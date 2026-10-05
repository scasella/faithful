// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":3}
// A negative start counts from the end; clamping it to 0 instead differs (seq.ts slice relIndex).
export function original(xs: number[], a: number, b: number): number[] {
  return xs.slice(a, b);
}
export function candidate(xs: number[], a: number, b: number): number[] {
  return xs.slice(Math.max(a, 0), b);
}

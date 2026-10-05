// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// Literal-start slice path (seq.ts slice, la >= 0): slice(2) and slice(3) differ only at length 3.
export function original(xs: number[]): number[] {
  return xs.slice(2);
}
export function candidate(xs: number[]): number[] {
  return xs.slice(3);
}

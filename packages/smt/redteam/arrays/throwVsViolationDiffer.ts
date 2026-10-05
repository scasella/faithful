// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":1}
// The original throws on the empty array; the candidate reads out of bounds there.
export function original(xs: number[]): number {
  if (xs.length === 0) {
    throw new Error("empty");
  }
  return xs[0];
}
export function candidate(xs: number[]): number {
  return xs[0];
}

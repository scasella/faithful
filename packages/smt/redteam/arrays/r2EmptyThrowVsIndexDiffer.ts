// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":1}
// Round 2, empty array: the original throws, the candidate reads xs[0] out of range (leaves the model): a difference.
export function original(xs: number[]): number {
  if (xs.length === 0) {
    throw new Error("empty");
  }
  return xs[0];
}
export function candidate(xs: number[]): number {
  return xs[0];
}

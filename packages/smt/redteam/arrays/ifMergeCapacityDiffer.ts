// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":1}
// As ifMergeCapacityEq with the wrong constant for the literal branch.
export function original(xs: number[], b: boolean): number {
  const ys = b ? xs : [7, 8, 9, 10, 11];
  return ys[ys.length - 1];
}
export function candidate(xs: number[], b: boolean): number {
  return b ? xs[xs.length - 1] : 10;
}

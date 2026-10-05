// @smt-redteam expect=equal bounds={"array":2,"string":1,"int":1}
// @smt-redteam adv=[[[1,2],true],[[1,2],false],[[3],true]]
// Merging arrays of different capacities (values.ts merge pads from the larger side), then reading the last slot.
export function original(xs: number[], b: boolean): number {
  const ys = b ? xs : [7, 8, 9, 10, 11];
  return ys[ys.length - 1];
}
export function candidate(xs: number[], b: boolean): number {
  return b ? xs[xs.length - 1] : 11;
}

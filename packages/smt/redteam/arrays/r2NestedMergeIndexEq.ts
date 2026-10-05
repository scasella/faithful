// @smt-redteam expect=equal bounds={"array":2,"string":1,"int":1}
// Round 2, nested arrays from an if-merge of different inner capacities (input vs literal [[1, 2, 3]]): reading
// [i][j] through the merge must use the right side's slots and both bounds checks in order.
export function original(xss: number[][], c: boolean, i: number, j: number): number {
  const t = c ? xss : [[1, 2, 3]];
  return t[i][j];
}
export function candidate(xss: number[][], c: boolean, i: number, j: number): number {
  if (c) {
    return xss[i][j];
  }
  const row = [[1, 2, 3]][i];
  return row[j];
}

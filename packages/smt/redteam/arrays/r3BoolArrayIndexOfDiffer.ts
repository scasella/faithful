// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// Round 3: indexOf(true) vs the count of trues: differ unless the array is all false or starts with exactly... (any [false, true]).
export function original(bs: boolean[]): number {
  return bs.indexOf(true);
}
export function candidate(bs: boolean[]): number {
  return bs.includes(true) ? 0 : -1;
}

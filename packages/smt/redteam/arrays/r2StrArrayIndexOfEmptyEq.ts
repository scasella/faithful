// @smt-redteam expect=equal bounds={"array":3,"string":2,"int":1}
// Round 2, string elements compared with === against "": svEq on sequences with padding slots.
export function original(ss: string[]): number {
  return ss.indexOf("");
}
export function candidate(ss: string[]): number {
  for (let i = 0; i < ss.length; i++) {
    if (ss[i].length === 0) {
      return i;
    }
  }
  return -1;
}

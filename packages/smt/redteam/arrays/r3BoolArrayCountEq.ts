// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":1}
// Round 3: boolean arrays: filter(b => b).length vs reduce counter vs indexOf/includes consistency.
export function original(bs: boolean[]): number {
  return bs.filter((b) => b).length * 10 + (bs.includes(false) ? 1 : 0);
}
export function candidate(bs: boolean[]): number {
  return bs.reduce((c, b) => (b ? c + 10 : c), 0) + (bs.indexOf(false) >= 0 ? 1 : 0);
}

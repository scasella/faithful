// @smt-redteam expect=equal bounds={"array":1,"string":4,"int":1} chars=["a","b",","]
// @smt-redteam adv=[["b,a,,ab,"],["ba,ab,a,b"]]
// split, drop empty parts, sort, join: against the same with an explicit comparator.
export function original(s: string): string {
  return s.split(",").filter((p) => p !== "").sort().join(";");
}
export function candidate(s: string): string {
  return s.split(",").filter((p) => p.length > 0).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(";");
}

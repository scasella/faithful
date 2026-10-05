// @smt-redteam expect=differ bounds={"array":2,"string":2,"int":1}
// Round 2, as r2StrArrayIncludesEq without the length condition: a proper prefix ("" or "a" of "ab") counts.
export function original(ss: string[], t: string): boolean {
  return ss.includes(t);
}
export function candidate(ss: string[], t: string): boolean {
  return ss.filter((s) => s.indexOf(t) === 0).length > 0;
}

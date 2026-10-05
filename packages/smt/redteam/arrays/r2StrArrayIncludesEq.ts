// @smt-redteam expect=equal bounds={"array":2,"string":2,"int":1}
// Round 2, includes on string arrays vs "starts with t and has t's length".
export function original(ss: string[], t: string): boolean {
  return ss.includes(t);
}
export function candidate(ss: string[], t: string): boolean {
  return ss.filter((s) => s.indexOf(t) === 0 && s.length === t.length).length > 0;
}

// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":1} chars=["a","B","é"]
// Round 2, default sort() (UTF-16 code-unit order: "B" 66 < "a" 97 < "é" 233) vs a three-way string comparator.
export function original(ss: string[]): string[] {
  return ss.slice().sort();
}
export function candidate(ss: string[]): string[] {
  return ss.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

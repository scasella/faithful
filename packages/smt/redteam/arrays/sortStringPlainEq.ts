// @smt-redteam expect=equal bounds={"array":3,"string":2,"int":1}
// Plain sort of strings vs an explicit code-unit comparator.
export function original(xs: string[]): string[] {
  return xs.slice().sort();
}
export function candidate(xs: string[]): string[] {
  return xs.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

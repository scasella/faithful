// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":1} chars=["a"]
// Round 3: testing acc === "" instead of the index drops leading empty strings: ["", "a"] gives "a", join gives ",a".
export function original(xs: string[]): string {
  return xs.reduce((acc, x) => (acc === "" ? x : acc + "," + x), "");
}
export function candidate(xs: string[]): string {
  return xs.join(",");
}

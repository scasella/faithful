// @smt-redteam expect=equal bounds={"array":1,"string":5,"int":1} chars=["a",","]
// @smt-redteam adv=[["a,,a,a,"],[",,,,,,,"],["aaaaaaaa"]]
// split then join with the same separator is the identity (split's `sum` bound feeds join's truncation).
export function original(s: string): string {
  return s.split(",").join(",");
}
export function candidate(s: string): string {
  return s;
}

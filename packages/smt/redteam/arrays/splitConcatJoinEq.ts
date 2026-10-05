// @smt-redteam expect=equal bounds={"array":1,"string":4,"int":1} chars=["a",","]
// @smt-redteam adv=[["a,aa,a,"],[",,,,"],["aaaaaaa"]]
// join of a concat of two split results.
export function original(s: string): string {
  return s.split(",").concat(s.split(",")).join("");
}
export function candidate(s: string): string {
  return s.split(",").join("") + s.split(",").join("");
}

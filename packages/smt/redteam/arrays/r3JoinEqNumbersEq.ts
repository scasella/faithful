// @smt-redteam expect=equal bounds={"array":2,"string":1,"int":2} adv=[[[9007199254740992,-1],[9007199254740992,-1]],[[12],[1,2]],[[-9007199254740992],[]]]
// Round 3: for NUMBER arrays, equal joins mean equal arrays (a number's text has no comma and is never empty).
export function original(a: number[], b: number[]): boolean {
  return a.join(",") === b.join(",");
}
export function candidate(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

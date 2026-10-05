// @smt-redteam expect=differ bounds={"array":2,"string":2,"int":1} chars=["a",","]
// Round 3: for STRING arrays, equal joins do not mean equal arrays: [] vs [""], ["a,a"] vs ["a","a"].
export function original(a: string[], b: string[]): boolean {
  return a.join(",") === b.join(",");
}
export function candidate(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// @smt-redteam expect=equal bounds={"array":3,"string":2,"int":1} chars=["a",","]
// @smt-redteam adv=[[["","",""]],[["￿,","",",\u0000"]]]
// Round 3: reduce with index building "x0,x1,..." equals join(",") (empty strings included).
export function original(xs: string[]): string {
  return xs.reduce((acc, x, i) => (i === 0 ? x : acc + "," + x), "");
}
export function candidate(xs: string[]): string {
  return xs.join(",");
}

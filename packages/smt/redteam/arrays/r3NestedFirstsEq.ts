// @smt-redteam expect=equal bounds={"array":2,"string":1,"int":2} adv=[[[[],[9007199254740992,1],[],[-9007199254740992],[],[]]]]
// Round 3: first elements of the non-empty rows: filter + map vs for...of accumulation.
export function original(xss: number[][]): number[] {
  return xss.filter((r) => r.length > 0).map((r) => r[0]);
}
export function candidate(xss: number[][]): number[] {
  let out: number[] = [];
  for (const r of xss) {
    if (r.length !== 0) out = out.concat([r[0]]);
  }
  return out;
}

// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":1}
// Round 3: last element of each non-empty row vs first element: differ when a row has two distinct elements.
export function original(xss: number[][]): number[] {
  return xss.filter((r) => r.length > 0).map((r) => r[0]);
}
export function candidate(xss: number[][]): number[] {
  let out: number[] = [];
  for (const r of xss) {
    if (r.length !== 0) out = out.concat([r[r.length - 1]]);
  }
  return out;
}

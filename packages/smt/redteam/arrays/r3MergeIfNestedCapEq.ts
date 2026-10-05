// @smt-redteam expect=equal bounds={"array":2,"string":1,"int":2}
// Round 3: an if-merge of nested arrays of different capacities, then a map over the rows.
export function original(xss: number[][], i: number): number[] {
  return (i > 0 ? xss.concat([[i, i]]) : xss).map((r) => r.length * 10 + (r.length > 0 ? r[r.length - 1] : 0));
}
export function candidate(xss: number[][], i: number): number[] {
  const base = xss.map((r) => r.length * 10 + (r.length > 0 ? r[r.length - 1] : 0));
  return i > 0 ? base.concat([20 + i]) : base;
}

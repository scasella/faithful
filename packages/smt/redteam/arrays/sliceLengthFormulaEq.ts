// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":3}
// @smt-redteam adv=[[[1,2,3],-9007199254740992,9007199254740992],[[1,2,3],2,1],[[1,2,3],-1,-2],[[],0,-1]]
// The length of xs.slice(a, b) written out with JavaScript's relative-index rules.
export function original(xs: number[], a: number, b: number): number {
  return xs.slice(a, b).length;
}
export function candidate(xs: number[], a: number, b: number): number {
  const n = xs.length;
  const s = a < 0 ? Math.max(n + a, 0) : Math.min(a, n);
  const e = b < 0 ? Math.max(n + b, 0) : Math.min(b, n);
  return Math.max(e - s, 0);
}

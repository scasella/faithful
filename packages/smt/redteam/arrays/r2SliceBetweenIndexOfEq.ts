// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":1} adv=[[[5,6,7,8,9,1],8,6],[[1,2,3,4,5,6],7,7],[[1,1,1,1,1,1],1,1]]
// Round 2, slice between two indexOf results with -1 handled as slice does (relIndex of a computed negative).
export function original(xs: number[], a: number, b: number): number[] {
  return xs.slice(xs.indexOf(a), xs.indexOf(b));
}
export function candidate(xs: number[], a: number, b: number): number[] {
  const n = xs.length;
  const i0 = xs.indexOf(a);
  const j0 = xs.indexOf(b);
  const i = i0 < 0 ? Math.max(n + i0, 0) : i0;
  const j = j0 < 0 ? Math.max(n + j0, 0) : j0;
  let out: number[] = [];
  for (let k = i; k < j; k++) {
    out = out.concat([xs[k]]);
  }
  return out;
}

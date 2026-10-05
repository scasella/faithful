// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1} adv=[[[5,6,7,8,9,1],8,6],[[1,2,3,4,5,6],7,7]]
// Round 2, slice between two indexOf results: a missing marker is -1, which slice counts from the end; the loop
// treats -1 as "no element". Differs when a marker is absent.
export function original(xs: number[], a: number, b: number): number[] {
  return xs.slice(xs.indexOf(a), xs.indexOf(b));
}
export function candidate(xs: number[], a: number, b: number): number[] {
  const i = xs.indexOf(a);
  const j = xs.indexOf(b);
  let out: number[] = [];
  for (let k = Math.max(i, 0); k < j; k++) {
    out = out.concat([xs[k]]);
  }
  return out;
}

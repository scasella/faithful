// @smt-redteam expect=differ mode=adaptive witness=[[1,2,3,4,5,6],[1,2,3,4,5]]
// FINDING (round 1): an index loop over xs.concat(ys) needs xs.length + ys.length iterations, up to 12 at the default
// bounds (arrays 6), but U = 10. equivalence.ts asserts that neither run reaches the unrolling bound, so every input
// with xs.length + ys.length >= 10 is silently dropped, and verifiedToK answers unsat, "Verified to k = 6", although
// the witness (arrays of 6 and 5 elements, inside the stated bounds) distinguishes the two functions.
export function original(xs: number[], ys: number[]): number {
  const zs = xs.concat(ys);
  let s = 0;
  for (let i = 0; i < zs.length; i++) {
    s = s + zs[i];
  }
  return s;
}
export function candidate(xs: number[], ys: number[]): number {
  const zs = xs.concat(ys);
  let s = 0;
  for (let i = 0; i < zs.length; i++) {
    s = s + zs[i];
  }
  return zs.length >= 11 ? s + 1 : s;
}

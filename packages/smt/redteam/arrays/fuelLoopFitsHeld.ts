// @smt-redteam expect=differ mode=adaptive witness=[[0,0,0]]
// Control for the fuel findings: a loop over 2 * xs.length differing at length 3 needs 6 iterations, which fits U at
// the third default step (arrays 6, U 8), so verifiedToK must find it (it does: sat at step 3).
export function original(xs: number[]): number {
  let s = 0;
  for (let i = 0; i < xs.length + xs.length; i++) {
    s = s + 1;
  }
  return s;
}
export function candidate(xs: number[]): number {
  return xs.length >= 3 ? 0 : 2 * xs.length;
}

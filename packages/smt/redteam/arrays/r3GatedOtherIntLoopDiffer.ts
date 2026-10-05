// @smt-redteam expect=differ mode=adaptive witness=[1000,[1,1,1,1,1]]
// Round 3: the loop is driven by the array LENGTH (3 * length iterations, up to 18 > U = 10) but only runs when a
// different integer n is >= 1000; the candidate differs only at length >= 5 with n >= 1000.
export function original(n: number, xs: number[]): number {
  if (n < 1000) return 0;
  let s = 0;
  for (let i = 0; i < 3 * xs.length; i++) {
    s = s + 1;
  }
  return s;
}
export function candidate(n: number, xs: number[]): number {
  if (n < 1000) return 0;
  return xs.length >= 5 ? 3 * xs.length + 1 : 3 * xs.length;
}

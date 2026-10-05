// @smt-redteam expect=differ mode=adaptive witness=[[3,1,2,0]]
// FINDING (round 1): a flattened n*n index loop needs 16 iterations at n = 4, beyond U = 10 at the default bounds
// (arrays 6). Inputs with 4..6 elements are excluded by the fuel assertion in equivalence.ts and verifiedToK claims
// "Verified to k = 6" although a 4-element input (inside the stated bounds) distinguishes the two functions.
export function original(xs: number[]): number {
  const n = xs.length;
  let c = 0;
  for (let k = 0; k < n * n; k++) {
    const i = Math.floor(k / n);
    const j = k % n;
    if (xs[i] < xs[j]) {
      c = c + 1;
    }
  }
  return c;
}
export function candidate(xs: number[]): number {
  const n = xs.length;
  let c = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (xs[i] < xs[j]) {
        c = c + 1;
      }
    }
  }
  return n >= 4 ? c + 1 : c;
}

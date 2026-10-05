// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[-2]]
// @redteam-note round 3: self-call after a loop that modifies another local used in the result
export function f(n: number): number { let m = n; for (let i = 0; i < 2; i++) { m = m - 1; } if (n < 1) return 0; return m + f(n - 1); }

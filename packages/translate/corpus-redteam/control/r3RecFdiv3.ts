// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[2],[3],[80],[-5]]
// @redteam-note round 3: recursion on Math.floor(n / 3) under the else of `n < 1`
export function f(n: number): number { if (n < 1) return 0; return 1 + f(Math.floor(n / 3)); }

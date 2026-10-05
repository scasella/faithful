// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[9],[-3]]
// @redteam-note round 3: recursion on Math.floor(n / 2) under `0 < n`
export function f(n: number): number { if (0 < n) return 1 + f(Math.floor(n / 2)); return 0; }

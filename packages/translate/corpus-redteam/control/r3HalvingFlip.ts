// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[9],[-3]]
// @redteam-note round 3: halving loop under `0 < n` (flipped)
export function f(n: number): number { let c = 0; while (0 < n) { n = Math.floor(n / 2); c++; } return c; }

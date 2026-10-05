// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[9],[-3]]
// @redteam-note round 3: halving by 3 under `1 <= n`
export function f(n: number): number { let c = 0; while (1 <= n) { n = Math.floor(n / 3); c++; } return c; }

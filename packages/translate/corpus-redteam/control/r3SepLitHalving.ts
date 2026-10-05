// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[5],[100],[1000]]
// @redteam-note round 3: halving loop with a numeric-separator bound `n > 1_0`
export function f(n: number): number { let c = 0; while (n > 1_0) { n = Math.floor(n / 2); c++; } return c; }

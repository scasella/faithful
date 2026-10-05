// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[64],[100],[37],[-5]]
// @redteam-note round 4: halving update placed after a return nested inside an if-join
export function f(n: number): number { let v = n; let c = 0; while (v > 0) { if (v % 7 === 0) { if (c > 1) return -c; } c++; v = Math.floor(v / 2); } return c; }

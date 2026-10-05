// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[100000],[1000000]]
// @redteam-note round 2: many iterations of a loop that has a return (Flow result)
export function f(n: number): number { let i = 0; while (i < n) { if (i === -1) return -1; i++; } return i; }

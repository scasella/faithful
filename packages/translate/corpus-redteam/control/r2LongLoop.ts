// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[100000],[1000000]]
// @redteam-note round 2: many iterations: the Lean loop must not overflow the stack where JS returns
export function f(n: number): number { let s = 0; for (let i = 0; i < n; i++) { s += 1; } return s; }

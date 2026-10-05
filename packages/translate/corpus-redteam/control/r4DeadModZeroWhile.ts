// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[3,0],[3,2],[0,0]]
// @redteam-note round 4: unused `% 0` inside a while: rangeOk false
export function f(n: number, d: number): number { let i = n; while (i > 0) { const r = i % d; i--; } return i; }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[5]]
export function f(n: number): number { let s = 0; for (let i = 0; i < n; i++) { s = s + i; } for (let i = n; i > 0; i--) { s = s - 1; } return s; }

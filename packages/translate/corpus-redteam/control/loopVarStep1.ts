// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[5]]
export function f(n: number): number { let c = 0; for (let i = 0; i < n; i += 1) { c = c + i; } return c; }

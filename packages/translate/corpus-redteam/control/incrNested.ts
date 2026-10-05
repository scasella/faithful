// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3]]
export function f(n: number): number { let c = 0; for (let i = 0; i < n; i = i + 1) { c = c + 1; } return c; }

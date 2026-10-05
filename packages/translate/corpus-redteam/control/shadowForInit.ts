// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[4]]
export function f(n: number): number { let i = 100; let c = 0; for (let i = 0; i < n; i++) { c = c + i; } return i + c; }

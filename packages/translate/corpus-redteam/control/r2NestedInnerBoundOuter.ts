// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[4],[-1]]
export function f(n: number): number { let s = 0; for (let i = 0; i < n; i++) { for (let j = 0; j < i; j++) { s += j; } } return s; }

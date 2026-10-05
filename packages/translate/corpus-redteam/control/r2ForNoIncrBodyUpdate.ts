// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[2],[7],[-3]]
export function f(n: number): number { let s = 0; for (let i = 0; i < n;) { s += i; i += 2; } return s; }

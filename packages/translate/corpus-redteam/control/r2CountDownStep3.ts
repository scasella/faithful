// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[3],[4],[10],[-7]]
export function f(n: number): number { let s = 0; for (let i = n; i > 0; i -= 3) { s = s * 2 + i; } return s; }

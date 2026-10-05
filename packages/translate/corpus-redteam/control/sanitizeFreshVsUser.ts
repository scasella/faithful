// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[1,2,3],[0,2,3]]
export function f(n: number, n_1: number, n1: number): number { let k = n; if (n > 0) { k = n_1; } let m = n; for (let i = 0; i < 2; i++) { m = m + n1; } return k * 1000 + m; }

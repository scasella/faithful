// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0,0],[3,4],[-2,1]]
export function f(n: number, m: number): number { if (n <= 0) return m; return f(n - 1, m + 1); }

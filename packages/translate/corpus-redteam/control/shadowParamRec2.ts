// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[4]]
export function f(n: number): number { if (n > 0) { const m = n; { const n = m + 5; if (n > 3) { return f(m - 1) + n; } } } return 0; }

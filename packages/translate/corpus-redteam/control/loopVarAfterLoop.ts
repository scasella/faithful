// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[10],[-3]]
export function f(n: number): number { let i = 0; for (; i < n; i++) { if (i * i > n) break; } return i; }

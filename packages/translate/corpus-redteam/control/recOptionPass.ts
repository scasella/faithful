// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[4],[-1]]
export function f(n: number): number | null { if (n < 0) return null; if (n === 0) return 0; return f(n - 2); }

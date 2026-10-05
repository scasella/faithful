// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[2]]
export function f(n: number): number | undefined { if (n > 0) return n; }

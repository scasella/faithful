// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[1],[-1],[0]]
export function f(n: number): string | null { if (n > 0) return ""; if (n < 0) return null; return "z"; }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[1],[0]]
export function f(n: number): number | undefined { const undefinedx = n; if (n > 0) return undefinedx; return undefined; }

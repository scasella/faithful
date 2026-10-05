// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[33],[34],[0],[-1]]
export function f(n: number): number { if (n <= 0) return 1; return 3 * f(n - 1); }

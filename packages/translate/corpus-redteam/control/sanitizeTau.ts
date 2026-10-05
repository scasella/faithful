// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[3,4]]
export function f(τ1: number, n: number): number { return τ1 * 2 + n * n; }

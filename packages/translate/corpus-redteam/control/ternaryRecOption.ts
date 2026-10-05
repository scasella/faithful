// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[-2]]
export function f(n: number): number | null { return n < 0 ? null : n === 0 ? 7 : f(n - 1); }

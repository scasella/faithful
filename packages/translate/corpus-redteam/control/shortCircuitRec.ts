// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[4],[-2]]
export function f(n: number): boolean { return n <= 0 || (n % 2 === 0 && f(n - 2)); }

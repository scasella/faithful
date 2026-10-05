// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[-1],[1],[2],[7],[8],[998],[999],[1000]]
export function f(n: number): number | null { return n <= 0 ? null : n % 2 === 0 ? f(n - 2) : n; }

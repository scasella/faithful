// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[2],[3],[10],[499],[500]]
export function f(n: number): boolean | null { if (n <= 0) return null; return n === 3 ? true : f(n - 1); }

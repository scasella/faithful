// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[7],[-2]]
export function f(n: number): number | null { return n > 0 ? (n > 5 ? null : n) : -1; }

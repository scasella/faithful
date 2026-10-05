// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[4],[-2],[499],[500]]
// @redteam-note round 2: decrement through a const m = n - 1 computed before the guard
export function f(n: number): number { const m = n - 1; if (n <= 0) return 0; return 1 + f(m); }

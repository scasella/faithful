// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[-1],[3],[499],[500]]
// @redteam-note round 2: guard and decrement through an alias const m = n
export function f(n: number): number { const m = n; if (m <= 0) return 0; return 1 + f(m - 1); }

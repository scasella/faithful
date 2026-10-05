// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[-1],[3],[499],[500]]
// @redteam-note round 2: boundary of the r2RecGuardBoolLocal finding: a direct conjunct n > 0 next to the let-bound boolean
export function f(n: number): number { const done = n <= 0; if (n > 0 && !done) return n + f(n - 1); return 0; }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[10]]
// @redteam-note round 3: while with break before the top-level counter update
export function f(n: number): number { let i = 0; let s = 0; while (i < n) { if (i > 5) break; s += i; i++; } return s * 1000 + i; }

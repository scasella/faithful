// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[4],[-1]]
// @redteam-note round 3: the bound `m` is shadowed by a body-local `const m`; the measure reads the outer one
export function f(n: number): number { const m = n; let s = 0; for (let i = 0; i < m; i++) { const m = 2; s += m + i; } return s; }

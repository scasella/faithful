// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[10],[78],[79]]
export function f(n: number): number { let a = 0; let b = 1; for (let i = 0; i < n; i++) { const t = a + b; a = b; b = t; } return a; }

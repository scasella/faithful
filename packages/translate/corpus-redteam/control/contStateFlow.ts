// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[7],[10]]
export function f(n: number): number { let s = 0; let t = 0; for (let i = 0; i < n; i++) { s = s + 1; if (i % 3 === 0) { t = t + s; continue; } t = t - 1; } return s * 1000 + t; }

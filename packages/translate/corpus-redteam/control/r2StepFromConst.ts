// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
export function f(n: number): number { const k = 2; let s = 0; for (let i = 0; i < n; i += k) { s += i; } return s; }

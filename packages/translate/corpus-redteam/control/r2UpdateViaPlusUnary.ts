// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
export function f(n: number): number { let s = 0; for (let i = 0; i < n; i = i + +1) { s += i; } return s; }

// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
export function f(n: number): number { let i = 0; while (i < f(n - 1)) { i++; } return i; }

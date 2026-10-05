// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
export function f(n: number): number { while (true) { if (n > 5) return n; n++; } }

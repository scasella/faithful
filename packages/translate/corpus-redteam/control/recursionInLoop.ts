// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note refused: a recursive call inside a loop is outside subset v1 (no termination measure)
export function f(n: number): number { if (n <= 0) return 0; let s = 0; for (let i = 0; i < 2; i++) { s = s + f(n - 1); } return s + 1; }

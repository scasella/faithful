// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: assignment inside an expression is outside subset v1 (use a statement)
export function f(n: number): number { let a = 0; let b = (a = n + 1) * 2; return a + b; }

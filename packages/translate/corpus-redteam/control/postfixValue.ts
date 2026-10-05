// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: ++/-- inside an expression is outside subset v1 (use it as a statement)
export function f(n: number): number { let a = n; const b = a++; const c = ++a; return b * 100 + c; }

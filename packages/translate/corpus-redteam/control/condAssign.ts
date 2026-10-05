// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: assignment inside an expression is outside subset v1 (use a statement)
// @redteam-note non-terminating in JS for n > 0 (i -= 1 in the condition undoes i++); must be refused
export function f(n: number): number { let c = 0; for (let i = 0; i < n && (i -= 1) < 100; i++) { c = c + 1; if (c > 5) return c; } return c; }

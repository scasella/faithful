// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: for...in loops are outside subset v1
export function f(xs: number[]): number { let c = 0; for (const k in xs) { c = c + 1; } return c; }

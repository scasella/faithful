// @redteam area=control status=held
// @redteam-expect refuse:unsupported-type
// @redteam-note refused: variable `g` is a function type; function values are outside subset v1
export function f(n: number): number { const g = (k: number): number => k + 1; return g(n); }

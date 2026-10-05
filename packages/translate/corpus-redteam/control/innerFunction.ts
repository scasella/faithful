// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: nested function declarations are outside subset v1
export function f(n: number): number { function g(k: number): number { return k + 1; } return g(n); }

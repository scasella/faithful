// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: calls to other functions are outside subset v1
function g(n: number): number { return n + 1; }
export function f(n: number): number { return g(n) * 2; }

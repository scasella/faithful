// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: `arguments` is outside subset v1
export function f(n: number): number { return arguments.length + n; }

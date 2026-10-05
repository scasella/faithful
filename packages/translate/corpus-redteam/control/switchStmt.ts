// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: switch statements are outside subset v1; use if/else
export function f(n: number): number { switch (n) { case 1: return 10; default: return 0; } }

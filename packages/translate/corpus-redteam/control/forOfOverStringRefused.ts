// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: for...of over a string iterates code points; it is outside subset v1 (index the string instead)
export function f(s: string): number { let c = 0; for (const ch of s) { c = c + 1; } return c; }

// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: try/catch is outside subset v1
export function f(n: number): number { try { if (n < 0) throw new Error("x"); return n; } catch (e) { return -1; } }

// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: labels are outside subset v1
export function f(n: number): number { let c = 0; outer: for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { if (j > i) continue outer; c = c + 1; } } return c; }

// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: do...while loops are outside subset v1; use while
export function f(n: number): number { let i = 0; do { i = i + 1; } while (i < n); return i; }

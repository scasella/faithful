// @redteam area=control status=held
// @redteam-expect refuse:unsupported-library
// @redteam-note refused: Number.MAX_SAFE_INTEGER is outside subset v1
export function f(n: number): number { let c = 0; for (let i = n; i < Number.MAX_SAFE_INTEGER; i++) { c = c + 1; if (c > 3) return c; } return c; }

// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: `k` is used outside its scope
export function f(xs: number[]): number { const s = xs.reduce((a, x) => a + x * k, 0); const k = 2; return s; }

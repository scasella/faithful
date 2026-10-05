// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: `k` is used outside its scope
export function f(xs: number[]): number[] { const ys = xs.map((x) => x + k); const k = 1; return ys; }

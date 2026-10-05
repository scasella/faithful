// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: `lim` is used outside its scope
export function f(xs: number[]): number[] { const ys = xs.filter((x) => x > lim); const lim = 3; return ys; }

// @redteam area=control status=held
// @redteam-expect refuse:unsupported-type
// @redteam-note refused: variable `r` can be null/undefined; null and undefined are supported only as a function's return type (T | null)
export function f(n: number): number | null { let r: number | null = null; if (n > 0) r = n; return r; }

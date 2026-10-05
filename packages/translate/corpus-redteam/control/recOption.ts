// @redteam area=control status=held
// @redteam-expect refuse:unsupported-type
// @redteam-note refused: variable `r` can be null/undefined; null and undefined are supported only as a function's return type (T | null)
// @redteam-note option-typed local: documented refusal
export function f(xs: number[], t: number): number | null { if (xs.length === 0) return null; if (xs[0] === t) return 0; const r = f(xs.slice(1), t); return r === null ? null : r + 1; }

// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note round 4: measure on b via `a % b` argument: refused (pattern not recognized; documented completeness limit)
export function f(a: number, b: number): number { if (b <= 0) return Math.abs(a); return f(b - 1, a % b) + 0; }

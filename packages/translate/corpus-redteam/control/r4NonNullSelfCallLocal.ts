// @redteam area=control status=held
// @redteam-expect refuse:unsupported-type
// @redteam-note round 4: `const r = f(n - 1)!` in an Option function (null at runtime): must be refused, is (unsupported-type)
export function f(n: number): number | null { if (n <= 0) return null; const r = f(n - 1)!; return r + 1; }

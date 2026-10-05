// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: `${f(n - 1)!}` in an Option function: refused
export function f(n: number): string | null { if (n <= 0) return null; return `${f(n - 1)!}x`; }

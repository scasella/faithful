// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
export function f(n: number): number { let x = n; x ??= 3; return x; }

// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
export function f(xs: number[]): boolean { let ok = false; for (const x of xs) { ok ||= x > 3; } return ok; }

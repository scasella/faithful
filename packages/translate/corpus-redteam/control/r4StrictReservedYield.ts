// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: strict-mode reserved word `yield` as a local: refused via TS1214
export function f(n: number): number { const yield = n; return yield; }

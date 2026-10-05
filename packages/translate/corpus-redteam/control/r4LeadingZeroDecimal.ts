// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: legacy decimal-with-leading-zero literal as a loop bound: refused via TS1489
export function f(n: number): number { let s = 0; for (let i = 0; i < 09; i++) s += n; return s; }

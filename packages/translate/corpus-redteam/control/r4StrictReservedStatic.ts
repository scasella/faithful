// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: strict-mode reserved word `static` as a loop-carried local: refused via TS1214
export function f(n: number): number { let static = n; for (let i = 0; i < 2; i++) static += i; return static; }

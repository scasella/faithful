// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: strict-mode reserved word `package` as a local in a module: refused via TS1214
export function f(n: number): number { let package = n; return package + 1; }

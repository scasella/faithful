// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: unreachable `var s` after break colliding with a let: refused via TS2451
export function f(n: number): number { let s = 0; for (let i = 0; i < n; i++) { s += i; if (i > 1) { break; var s = 100; } } return s; }

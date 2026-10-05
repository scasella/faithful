// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: hoisted unreachable `var f` shadowing the function (JS: TypeError): refused
export function f(n: number): number { if (n <= 0) return 0; return 1 + f(n - 1); var f = 3; }

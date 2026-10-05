// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: named function expression recursing through its inner name `g`: refused (not treated as a self-call), sound
export const f = function g(n: number): number { return n <= 0 ? 0 : n + g(n - 1); };

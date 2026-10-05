// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note round 3: `i = i + -1` counting down is not a recognized step: refused; completeness
export function f(n: number): number { let c = 0; for (let i = n; i > 0; i = i + -1) { c++; } return c; }

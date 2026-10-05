// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note round 3: bound `xs.length` changes in the body: refused (E must be loop-invariant), although JS terminates; completeness
export function f(xs: number[]): number { let c = 0; for (let i = 0; i < xs.length; i++) { xs = xs.slice(1); c++; } return c; }

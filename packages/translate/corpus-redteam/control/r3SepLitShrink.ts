// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,3]],[[1,2,3,4,5,6,7,8,9,10,11,12]],[[]]]
// @redteam-note round 3: shrinking loop with a numeric-separator bound `xs.length > 1_0`
export function f(xs: number[]): number { let c = 0; while (xs.length > 1_0) { xs = xs.slice(1); c++; } return c; }

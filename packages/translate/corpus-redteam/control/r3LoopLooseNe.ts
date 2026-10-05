// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[]],[[1,2,3]]]
// @redteam-note round 3: shrinking loop under loose `xs.length != 0`
export function f(xs: number[]): number { let c = 0; while (xs.length != 0) { c++; xs = xs.slice(1); } return c; }

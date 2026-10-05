// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,3]],[[]],[[5]]]
// @redteam-note round 3: recursion guarded by `xs.length !== 0` in the then-branch
export function f(xs: number[]): number { if (xs.length !== 0) return xs[0] * 2 + f(xs.slice(1)); return 0; }

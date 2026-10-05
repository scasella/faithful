// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,3],[4,5]],[[],[1]],[[1],[]],[[1,2],[]]]
// @redteam-note round 4: two array params both sliced, guard only on xs (measure xs.length)
export function f(xs: number[], ys: number[]): number { if (xs.length === 0) return ys.length; return xs[0] + f(xs.slice(1), ys.slice(1)); }

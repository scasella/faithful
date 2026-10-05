// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[]],[[1]],[[1,2,3]]]
// @redteam-note round 2: guard through const len = xs.length
export function f(xs: number[]): number { const len = xs.length; if (len === 0) return 0; return xs[0] + f(xs.slice(1)); }

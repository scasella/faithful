// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[]],[[1,2,3]]]
export function f(xs: number[]): number { if (xs.length === 0) return 0; return xs[0] + f(xs.slice(1)); }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[]],[[1,2,3]]]
export function f(xs: number[]): number { let s = 0; while (xs.length > 0) { s = s + xs[0]; xs = xs.slice(1); } return s; }

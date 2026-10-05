// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[]],[[1]],[[1,2]],[[1,2,3,4,5]]]
export function f(xs: number[]): number { if (!(xs.length > 0)) return 0; return 1 + f(xs.slice(2)); }

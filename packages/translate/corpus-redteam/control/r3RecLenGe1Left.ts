// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[]],[[1,2,3]]]
// @redteam-note round 3: `1 <= xs.length` (literal on the left)
export function f(xs: number[]): number { if (1 <= xs.length) return xs[0] + f(xs.slice(1)); return 0; }

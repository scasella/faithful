// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[]],[[1,2]]]
// @redteam-note round 3: `0 != xs.length` (loose, literal left)
export function f(xs: number[]): number { if (0 != xs.length) return 1 + f(xs.slice(1)); return 0; }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[3,1,2]]]
export function f(xs: number[]): number[] { const ys = xs.slice().sort((a, b) => a - b); return ys; }

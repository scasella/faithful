// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2]],[[]]]
export function f(xs: number[]): number { let i = 0; let c = 0; while (i < xs.length) { const ys = xs; i = i + 1; c = c + ys.length; } return c; }

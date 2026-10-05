// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,3]],[[]],[[1,2,3,4,5,6,7,8,9,10,11]]]
export function f(xs: number[]): number { let i = 0; while (i < 10) { if (i >= xs.length) break; i = i + 1; } return xs.length > i ? xs[i] : i; }

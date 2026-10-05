// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[5]],[[0,1]],[[]]]
// @redteam-note round 4: unused out-of-range index inside a for...of: rangeOk false
export function f(xs: number[]): number { for (const x of xs) { const y = xs[x]; } return xs.length; }

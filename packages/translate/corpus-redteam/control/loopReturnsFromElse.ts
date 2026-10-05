// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,-1,2,3]],[[]],[[1,2]]]
export function f(xs: number[]): string { let acc = ""; for (let i = xs.length - 1; i >= 0; i--) { if (xs[i] > 0) { acc = acc + "+"; } else { return acc + "!" + i; } } return acc; }

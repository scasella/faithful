// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[3,2,1]],[[1,0,5]],[[]],[[4]]]
// @redteam-note round 4: loop condition whose FIRST conjunct indexes (xs[i] !== 0) and second is the measure: the index check runs before the bound on the exit iteration
export function f(xs: number[]): number { let i = 0; while (xs[i] !== 0 && i < xs.length) { i++; } return i; }

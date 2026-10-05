// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,3],2],[[],5],[[1],-1]]
export function f(xs: number[], n: number): number { let i = 0; while (xs.length > i && i < n) { i = i + 1; } return i; }

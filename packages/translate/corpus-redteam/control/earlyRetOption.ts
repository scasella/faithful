// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,3],2],[[],1],[[5],6]]
export function f(xs: number[], t: number): number | null { for (let i = 0; i < xs.length; i++) { if (xs[i] === t) return i; } return null; }

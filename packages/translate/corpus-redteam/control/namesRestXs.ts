// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,3],0,2],[[],5,1]]
export function f(xs: number[], rest: number, r: number): number { let s = rest; for (const x of xs) { if (x === r) return s; s = s + x; } return s; }

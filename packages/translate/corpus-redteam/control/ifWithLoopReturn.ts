// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,3],2],[[1,2],5],[[],0]]
export function f(xs: number[], n: number): number { let c = 0; if (n > 0) { for (const x of xs) { if (x === n) return 1; c = c + 1; } } return c * 100; }

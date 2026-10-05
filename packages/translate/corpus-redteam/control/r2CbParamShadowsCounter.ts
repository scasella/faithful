// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[]],[[1,2]],[[3,-1,4]]]
// @redteam-note round 2: a callback parameter named like the mutable loop counter is not a capture
export function f(xs: number[]): number { let s = 0; for (let i = 0; i < xs.length; i++) { s += xs.map((i) => i * 2).reduce((a, b) => a + b, 0); } return s; }

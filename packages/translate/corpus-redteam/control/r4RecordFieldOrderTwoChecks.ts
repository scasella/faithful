// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2],1073741824,5],[[1,2],2,5],[[],3,0]]
// @redteam-note round 4: object literal: index check first, overflow second
interface P { a: number; b: number }
export function f(xs: number[], m: number, i: number): P { return { b: xs[i], a: m * m }; }

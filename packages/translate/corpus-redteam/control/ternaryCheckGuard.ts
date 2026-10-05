// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2],5],[[1,2],1],[[],0],[[9007199254740992],0]]
export function f(xs: number[], i: number): number { return i < xs.length && i >= 0 ? xs[i] * 2 : -1; }

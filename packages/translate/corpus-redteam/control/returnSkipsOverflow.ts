// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,0,9007199254740992]],[[9007199254740992,0]],[[2,3]]]
export function f(xs: number[]): number { let s = 0; for (let i = 0; i < xs.length; i++) { if (xs[i] === 0) return s; s = s + xs[i] * xs[i]; } return s; }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[9007199254740992,0,9007199254740992]],[[0,9007199254740992,9007199254740992]],[[3,0]],[[9007199254740992,2]]]
export function f(xs: number[]): number { let p = 1; for (const x of xs) { if (x === 0) throw new Error("zero"); p = p * x; } return p; }

// @redteam area=arithmetic status=held expect=ok
// @inputs [[[]],[[1,2,3]],[[-7,5,-2,9]],[[9007199254740992,1]],[[94906265,94906265]],[[-1,-1,-1]]]
export function forOfArith(xs: number[]): number { let p = 1; for (const x of xs) { p = p * x - Math.ceil(x / 3); } return p; }

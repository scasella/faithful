// @redteam area=arithmetic status=held expect=ok
// @inputs [[[]],[[1,2,3]],[[94906265,1]],[[94906266]],[[9007199254740992,0]],[[67108864,67108864]],[[-9007199254740992,1]]]
export function reduceSum(xs: number[]): number { return xs.reduce((acc, x) => acc + x * x, 0); }

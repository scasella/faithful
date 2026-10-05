// @redteam area=arithmetic status=held expect=ok round=3
// @inputs [[true,5],[false,-5],[true,-9007199254740992]]
// @tags ["ok","ok","ok"]
export function r3MinBoolArg(a: boolean, b: number): number { return Math.min(b, a ? 1 : 0); }

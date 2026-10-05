// @redteam area=arithmetic status=held expect=ok
// @inputs [[1,0],[7,-2],[-7,2],[9007199254740992,-3]]
export function nonNullDiv(a: number, b: number): number { return Math.floor(a! / b!); }

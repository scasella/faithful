// @redteam area=arithmetic status=held expect=ok round=3
// Math?.floor(a / b) is accepted: Math is never nullish, so it is exactly Math.floor (sound)
// @inputs [[7,2],[-7,2],[7,-2],[1,0]]
// @tags ["ok","ok","ok","range-violation"]
export function r3OptChainMath(a: number, b: number): number { return Math?.floor(a / b); }

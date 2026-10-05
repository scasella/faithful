// @redteam area=arithmetic status=held expect=ok round=3
// Math.floor/ceil of non-division integer expressions are the identity
// @inputs [[-7,3],[7,-3],[5,0],[-9007199254740992,7]]
// @tags ["ok","ok","range-violation","ok"]
export function r3FloorNoDiv(a: number, b: number): number { return Math.floor(a % b) + Math.ceil(-a); }

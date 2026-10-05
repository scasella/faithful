// @redteam area=arithmetic status=held expect=ok round=4
// nested truncated remainders with mixed signs at the bound, including a -0 divisor from b % c
// @inputs [[-7,3,2],[7,-3,-2],[-9007199254740992,7,3],[9007199254740992,-9007199254740991,5],[-1,9007199254740992,-9007199254740992],[-1,-9007199254740992,9007199254740992]]
// @tags ["ok","ok","ok","ok","range-violation","range-violation"]
export function r4ModChain(a: number, b: number, c: number): number[] {
  return [(a % b) % c, a % (b % c), (a % b) * (a % c), -(a % b) % c];
}

// @redteam area=arithmetic status=held expect=ok round=2
// @inputs [[7,-3],[-7,3],[-7,-3],[9007199254740992,3],[-9007199254740992,-9007199254740991],[9007199254740991,-2],[-9007199254740992,-1],[3,0]]
// @tags ["ok","ok","ok","ok","ok","range-violation","ok","range-violation"]
export function negIdentity(a: number, b: number): number[] {
  return [-Math.floor(a / b), Math.ceil(-a / b), Math.ceil(a / -b), Math.floor(a / b) * b + (a % b) - a];
}

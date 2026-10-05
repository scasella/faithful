// @redteam area=arithmetic status=held expect=ok round=4
// ceil - floor is 1 exactly on inexact quotients; floor(-a / -b) = floor(a / b); ceil(a/b) + floor(-a/b) = 0, at +-2^53
// @inputs [[-7,2],[7,-2],[-9007199254740992,3],[9007199254740992,-3],[-9007199254740992,-9007199254740992],[1,9007199254740992],[-1,9007199254740992],[9007199254740991,9007199254740992],[9007199254740992,9007199254740991],[-9007199254740992,9007199254740991]]
// @tags ["ok","ok","ok","ok","ok","ok","ok","ok","ok","ok"]
export function r4CeilFloorCrossSign(a: number, b: number): number[] {
  return [Math.ceil(a / b) - Math.floor(a / b), Math.floor(-a / -b), Math.ceil(a / b) + Math.floor(-a / b)];
}

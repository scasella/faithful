// @redteam area=arithmetic status=held expect=ok round=3
// negative literals in application positions: (Int.tmod a (-3 : Int)) etc.
// @inputs [[7],[-7],[0],[9007199254740992],[-9007199254740992]]
// @tags ["ok","ok","ok","range-violation","range-violation"]
export function r3NegLitArgs(a: number): number[] {
  return [a % -3, Math.floor(a / -2), Math.ceil(a / -7), Math.max(a, -1), Math.min(-5, a), Math.abs(-a) - -1];
}

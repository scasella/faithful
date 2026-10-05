// @redteam area=arithmetic status=held expect=ok round=4
// unary minus applied to ternaries whose branches hold fdiv / tmod
// @inputs [[-7,true],[-7,false],[9007199254740992,true],[-9007199254740992,false]]
// @tags ["ok","ok","ok","range-violation"]
export function r4UnaryMinusTernary(a: number, c: boolean): number {
  return -(c ? a : -a) - -(c ? Math.floor(a / 3) : a % 3);
}

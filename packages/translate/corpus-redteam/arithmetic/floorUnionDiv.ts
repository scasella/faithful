// @redteam area=arithmetic status=held expect=ok round=2
// round 1 fixed % with a literal-union divisor; Math.floor/Math.ceil with one must be checked too
// @inputs [[7,false,false],[7,true,false],[7,false,true],[-7,false,false]]
// @tags ["ok","range-violation","range-violation","ok"]
export function floorUnionDiv(a: number, c: boolean, d: boolean): number {
  return Math.floor(a / (c ? 0 : 2)) - Math.ceil(a / (d ? 0 : 3));
}

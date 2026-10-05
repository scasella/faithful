// @redteam area=arithmetic status=held expect=ok round=2
// @inputs [[false,false,false],[false,false,true],[false,true,false],[false,true,true],[true,false,false],[true,false,true],[true,true,false],[true,true,true]]
// @tags ["ok","ok","ok","ok","ok","ok","ok","ok"]
export function boolAlgebra(a: boolean, b: boolean, c: boolean): boolean[] {
  return [!(a && b) === (!a || !b), a == b, (a !== b) !== c, a ? b : c, !a !== b, a != c || b];
}

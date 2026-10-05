// @redteam area=arithmetic status=held expect=ok round=3
// string += number / boolean / negated number; -0 never printed
// @inputs [["x",-5],["",0],["ab",9007199254740992],["q",-9007199254740992]]
// @tags ["ok","ok","ok","ok"]
export function r3StrCompound(s: string, n: number): string {
  let t = s;
  t += n;
  t += n < 0;
  t += -n;
  t += n * -1;
  return t;
}

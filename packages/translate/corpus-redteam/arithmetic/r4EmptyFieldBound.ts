// @redteam area=arithmetic status=held expect=ok round=4
// int-bound ts leaf on record fields named "" and "a b" (not identifiers): the precondition must not reject everything
// @inputs [[{"":1,"a b":2}],[{"":9007199254740992,"a b":1}]]
// @tags ["ok","range-violation"]
export function r4EmptyFieldBound(r: { "": number; "a b": number }): number {
  return r[""] + r["a b"];
}

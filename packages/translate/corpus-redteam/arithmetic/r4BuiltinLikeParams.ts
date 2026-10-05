// @redteam area=arithmetic status=held expect=ok round=4
// parameters named like Lean/Faithful heads that are not in LEAN_RESERVED (Neg, HAdd, ite, Flow, inRange, Std)
// @inputs [[1,2,3,4,5,6],[2,1,3,3,5,5],[2,1,4,3,5,6]]
// @tags ["ok","ok","ok"]
export function r4BuiltinLikeParams(Neg: number, HAdd: number, ite: number, Flow: number, inRange: number, Std: number): boolean {
  return (Neg < HAdd && ite <= Flow) || inRange === Std;
}

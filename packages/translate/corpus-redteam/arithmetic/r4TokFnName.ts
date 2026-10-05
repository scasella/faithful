// @redteam area=arithmetic status=divergence expect=ok round=4 input=[7] ts=ok:1 lean=lean-error severity=completeness
// the function itself named `repeat` (a builtin Lean token)
export function repeat(a: number): number {
  return a % 3;
}

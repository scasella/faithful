// @redteam area=arithmetic status=divergence expect=ok round=4 input=[3] ts=ok:6 lean=lean-error severity=completeness
// a parameter named `using` (a builtin Lean token, not in LEAN_RESERVED): the emitted model does not parse ("unexpected token 'using'; expected '_' or identifier")
export function r4TokParam(using: number): number {
  return using * 2;
}

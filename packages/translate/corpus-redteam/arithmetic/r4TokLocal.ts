// @redteam area=arithmetic status=divergence expect=ok round=4 input=[3] ts=ok:16 lean=lean-error severity=completeness
// a local named `until` (a builtin Lean token): the emitted model does not parse
export function r4TokLocal(a: number): number {
  const until = a + 1;
  return until * until;
}

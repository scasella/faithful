// @redteam area=arithmetic status=divergence expect=ok round=4 input=[{"matches":2}] ts=ok:3 lean=lean-error severity=completeness
// a record field named `matches` (a builtin Lean token): Records.register only avoids STRUCT_RESERVED, the structure does not parse
export function r4TokField(r: { matches: number }): number {
  return r.matches + 1;
}

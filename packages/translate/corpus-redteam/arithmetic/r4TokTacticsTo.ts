// @redteam area=arithmetic status=divergence expect=ok round=4 input=[7] ts=ok:3 lean=tactics-error severity=completeness
// a parameter named `to` compiles under `import Faithful.Core` (so tsVsLean agrees) but `to` is a Mathlib token: the theorem file (`import Faithful.Tactics`) does not parse, so no proof about this function can ever check
export function r4TokTacticsTo(to: number): number {
  return Math.floor(to / 2);
}

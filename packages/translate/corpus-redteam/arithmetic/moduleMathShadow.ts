// @redteam area=arithmetic status=divergence input=[7,2] ts=ok:3.5 lean=ok:3 expect=refuse code=mutable-capture|unsupported-syntax round=2
// The refusal code is the fixer's choice (the subset text names none for this case): either code passes.
// A module-level binding named `Math` shadows the global; lower.ts call() treats `Math.floor(a / b)` as the builtin
// whenever the `Math` symbol is not function-local (`!sym || !this.isLocal(sym)`), so it is modeled as Int.fdiv.
// plainTs omits this statement, so tsVsLean runs the global Math and reports agreement: the harness cannot see it.
const Math = { floor: (x: number): number => x };
export function moduleMathShadow(a: number, b: number): number {
  return Math.floor(a / b);
}

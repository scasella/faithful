// @redteam area=arithmetic status=divergence input=[7,2] ts=ok:3.5 lean=ok:3 expect=refuse code=mutable-capture|unsupported-syntax round=2
// The refusal code is the fixer's choice (the subset text names none for this case): either code passes.
// A top-level statement replaces the builtin Math.floor; translate() looks only at the function and the module
// constants it reads, so this module-level mutation is ignored (and is absent from plainTs, so tsVsLean agrees).
Math.floor = (x: number): number => x;
export function mathFloorPatched(a: number, b: number): number {
  return Math.floor(a / b);
}

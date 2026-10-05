// @redteam area=arithmetic status=divergence input=[-5] ts=ok:-5 lean=ok:5 expect=refuse code=mutable-capture|unsupported-syntax round=2
// The refusal code is the fixer's choice (the subset text names none for this case): either code passes.
// Same root cause as mathFloorPatched, without any division: Math.abs is modeled as Faithful.iabs.
Math.abs = (x: number): number => x;
export function mathAbsPatched(a: number): number {
  return Math.abs(a);
}

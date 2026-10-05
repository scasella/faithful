// @redteam area=arrays status=divergence input=[[5]] ts={"tag":"ok","value":[5]} lean={"tag":"ok","value":[0]}
// @redteam note=soundness (pre = true): a function-expression callback with a `this` parameter; lower.ts lambda() binds fn.parameters positionally, so the erased `this` pseudo-parameter gets the element and `x` gets the index (model = map with index)
// @redteam expect=refuse code=this|unsupported-syntax
// @redteam inputs=[[[5]],[[5,6,7]],[[]],[[-1]]]
export function thisMap(xs: number[]): number[] {
  return xs.map(function (this: number, x: number): number {
    return x;
  });
}

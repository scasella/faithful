// @redteam area=arrays status=divergence input=[[3]] ts={"tag":"ok","value":[3]} lean={"tag":"ok","value":[]}
// @redteam note=soundness (pre = true): filter callback `function (this: number, x: number): boolean`; the model binds `this` to the element and `x` to the index, so it filters by index > 0
// @redteam expect=refuse code=this|unsupported-syntax
// @redteam inputs=[[[5,0,7,-2]],[[]],[[3]]]
export function thisFilter(xs: number[]): number[] {
  return xs.filter(function (this: number, x: number): boolean {
    return x > 0;
  });
}

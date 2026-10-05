// @redteam area=arrays status=divergence input=[[1,2]] ts={"tag":"ok","value":12} lean={"tag":"ok","value":21}
// @redteam note=soundness (pre = true): reduce callback `function (this: number, acc, x)`; the model binds `this` to the accumulator, `acc` to the element and `x` to the index
// @redteam expect=refuse code=this|unsupported-syntax
// @redteam inputs=[[[5,6,7]],[[]],[[1,2]]]
export function thisReduce(xs: number[]): number {
  return xs.reduce(function (this: number, acc: number, x: number): number {
    return acc * 10 + x;
  }, 0);
}

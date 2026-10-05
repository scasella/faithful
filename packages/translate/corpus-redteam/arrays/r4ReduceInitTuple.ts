// @redteam status=held
// @redteam expect=refuse code=unsupported-type
// @redteam inputs=[[[3],[1,2]]]
// Round 4 (arrays): tuple as the reduce initial value of an array accumulator.
export function r4ReduceInitTuple(xs: number[], t: [number, number]): number[] {
  return xs.reduce((acc: number[], x) => acc.concat([x]), t);
}

// @redteam status=held
// @redteam expect=refuse code=unsupported-type
// @redteam inputs=[[[[1,2]]]]
// Round 4 (arrays): callback parameter annotated number[] receives tuples.
export function r4CallbackParamArrayOfTuple(ps: [number, number][]): number[] {
  return ps.map((p: number[]) => p.length);
}

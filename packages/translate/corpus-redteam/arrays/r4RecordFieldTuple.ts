// @redteam status=held
// @redteam expect=refuse code=unsupported-type
// @redteam inputs=[[[1,2]]]
// Round 4 (arrays): tuple stored in a number[] record field.
export function r4RecordFieldTuple(t: [number, number]): number {
  const r: { a: number[] } = { a: t };
  return r.a.length;
}

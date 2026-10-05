// @redteam status=held
// @redteam expect=refuse code=unsupported-type
// @redteam inputs=[[[1,2]]]
// Round 4 (arrays): tuple as an element of a number[][] literal.
export function r4ArrayLitTupleElem(t: [number, number]): number {
  const xss: number[][] = [t, [1]];
  return xss[0].length + xss[1].length;
}

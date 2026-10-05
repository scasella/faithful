// @redteam status=held
// @redteam expect=refuse code=unsupported-type
// @redteam inputs=[[[1,2]]]
// Round 4 (arrays): array of tuples widened to number[][] by a let annotation.
export function r4MapTupleToArrayLet(xs: number[]): number {
  const ps: number[][] = xs.map((x): [number, number] => [x, x + 1]);
  return ps.map((p) => p.length).reduce((a, b) => a + b, 0);
}

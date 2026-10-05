// @redteam status=held
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[[[1,2]]]]
// Round 4 (arrays): tuple indexed by a computed index.
export function r4TupleIndexComputedRefuse(ps: [number, number][]): number[] {
  return ps.map((p, i) => p[i % 2]);
}

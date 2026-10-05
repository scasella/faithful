// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[[1,2],[3,4]]],[[]]]
// Round 4 (arrays): ReadonlyArray of readonly tuples.
export function r4ReadonlyTupleArray(ps: ReadonlyArray<readonly [number, number]>): number[] {
  return ps.map((p) => p[0] * 10 + p[1]).filter((v, i) => v > i);
}

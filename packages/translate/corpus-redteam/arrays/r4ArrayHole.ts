// @redteam status=held
// @redteam expect=refuse code=unsupported-type
// @redteam inputs=[[1,3]]
// Round 4 (arrays): array hole.
export function r4ArrayHole(a: number, b: number): number {
  const xs = [a, , b];
  return xs.length;
}

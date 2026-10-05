// @redteam status=held
// @redteam expect=refuse code=missing-annotation
// @redteam inputs=[[4]]
// Round 4 (arrays): length of an unannotated empty literal.
export function r4EmptyLiteralLength(n: number): number {
  return [].length + n;
}

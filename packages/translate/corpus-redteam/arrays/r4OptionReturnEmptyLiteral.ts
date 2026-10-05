// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3],false],[[1,2],false],[[1],true]]
// Round 4 (arrays): empty literal returned through an option return type.
export function r4OptionReturnEmptyLiteral(xs: number[], c: boolean): number[] | null {
  if (c) return null;
  return xs.length > 2 ? [] : xs.slice(1);
}

// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[{"end":2,"fun":"b"},{"end":5,"fun":"a"},{"end":2,"fun":"a"}]]]
// Round 4 (arrays): sort keys on fields whose names are Lean keywords.
export function r4SortKeyKeywordField(rs: { end: number; fun: string }[]): { end: number; fun: string }[] {
  return rs
    .slice()
    .sort((a, b) => b.end - a.end)
    .concat(rs.slice().sort((a, b) => (a.fun < b.fun ? -1 : a.fun > b.fun ? 1 : 0)));
}

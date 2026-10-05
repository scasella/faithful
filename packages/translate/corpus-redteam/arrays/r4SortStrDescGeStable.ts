// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[{"s":"b","n":1},{"s":"a","n":2},{"s":"b","n":3},{"s":"c","n":4},{"s":"a","n":5}]]]
// Round 4 (arrays): descending string key through >= and ===, stability on equal keys.
export function r4SortStrDescGeStable(rs: { s: string; n: number }[]): { s: string; n: number }[] {
  return rs.filter((r) => r.n > 0).sort((a, b) => (a.s >= b.s ? (a.s === b.s ? 0 : -1) : 1));
}

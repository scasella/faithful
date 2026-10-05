// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[{"v":1,"s":"a"},{"v":3,"s":"b"},{"v":3,"s":"c"}]],[[]]]
// Round 4 (arrays): reduce over records with an element as the initial value (out of range on []).
export function r4ReduceRecordsMax(rs: { v: number; s: string }[]): { v: number; s: string } {
  return rs.reduce((best, r) => (r.v > best.v ? r : best), rs[0]);
}

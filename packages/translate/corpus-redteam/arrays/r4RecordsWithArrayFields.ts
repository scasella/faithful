// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[{"k":"x","v":[3,1]},{"k":"y","v":[]}]]]
// Round 4 (arrays): record results with array fields, sort inside a callback.
export function r4RecordsWithArrayFields(rs: { k: string; v: number[] }[]): { k: string; v: number[] }[] {
  return rs.map((r) => ({ k: r.k + r.v.length, v: r.v.slice().sort((a, b) => a - b).concat(r.v) }));
}

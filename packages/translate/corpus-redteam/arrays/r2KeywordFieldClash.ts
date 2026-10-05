// @redteam area=arrays status=held
// @redteam note=record fields `end` (a Lean keyword, sanitized with a _ suffix) and `end_` in one record
// @redteam expect=ok
// @redteam inputs=[[[{"end":1,"end_":2}]]]
type R = { end: number; end_: number };
export function f(rs: R[]): R[] {
  return rs.map((r) => ({ end: r.end_, end_: r.end * 10 }));
}

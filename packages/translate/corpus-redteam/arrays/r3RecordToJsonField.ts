// @redteam area=arrays status=held
// @redteam note=record fields named toJSON and valueOf holding numbers
// @redteam expect=ok
// @redteam inputs=[[[{"toJSON":1,"valueOf":2}]]]
type R = { toJSON: number; valueOf: number };
export function tj(rs: R[]): R[] {
  return rs.map((r) => ({ toJSON: r.valueOf, valueOf: r.toJSON }));
}

// @redteam area=arrays status=held
// @redteam note=record types named Repr / Inhabited / Array (Lean class and type names the emitter derives or references)
// @redteam expect=ok
// @redteam inputs=[[[{"k":1}],[{"v":"a"}]]]
type Repr = { k: number };
type Inhabited = { v: string };
export function f(rs: Repr[], is: Inhabited[]): Inhabited[] {
  return rs.map((r): Inhabited => ({ v: `${r.k}` })).concat(is);
}

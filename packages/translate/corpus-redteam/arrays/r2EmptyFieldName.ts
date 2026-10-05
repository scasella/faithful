// @redteam area=arrays status=divergence input=[[{"":1,"a":2}]] ts={"tag":"ok","value":[{"":2,"a":2}]} lean=lean-error("unexpected token ':='; expected '_', '}', identifier or term")
// @redteam note=completeness (accepted, but the model does not elaborate): types.ts leanIdent("") returns "" so the structure field and record literal have no name; the correct fix gives the field a non-empty Lean name (JSON key stays "")
// @redteam expect=ok
// @redteam inputs=[[[{"":1,"a":2}]]]
type R = { "": number; a: number };
export function f(rs: R[]): R[] {
  return rs.map((r): R => ({ "": r.a, a: r[""] + 1 }));
}

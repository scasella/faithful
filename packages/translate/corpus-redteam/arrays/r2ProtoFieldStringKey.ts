// @redteam area=arrays status=divergence input=[[1,2]] ts={"tag":"ok","value":[{"a":1},{"a":2}]} lean={"tag":"ok","value":[{"__proto__":1,"a":1},{"__proto__":2,"a":2}]}
// @redteam note=soundness (pre = true): quoted "__proto__" key: same prototype-setting semantics as the bare key
// @redteam expect=refuse code=unsupported-syntax|unsupported-type
// @redteam inputs=[[[1,2]]]
type R = { __proto__: number; a: number };
export function mk(xs: number[]): R[] {
  return xs.map((x): R => ({ "__proto__": x, a: x }));
}

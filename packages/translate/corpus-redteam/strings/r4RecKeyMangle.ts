// @redteam area=strings status=held
// @inputs [[{"a-b":"1","a_u2db":"2","\u00e9":"3","v_ue9":"4","x\u00e9":"5","x_ue9":"6"}]]
export function f(r: { "a-b": string; a_u2db: string; "é": string; v_ue9: string; "xé": string; x_ue9: string }): string {
  return r["a-b"] + "|" + r.a_u2db + "|" + r["é"] + "|" + r.v_ue9 + "|" + r["xé"] + "|" + r.x_ue9;
}

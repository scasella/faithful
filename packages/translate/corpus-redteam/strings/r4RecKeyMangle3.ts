// @redteam area=strings status=held
// @inputs [[{"a-b":"1","a_u2db":"2","a_u2db_":"3","a-b_":"4"}]]
export function f(r: { "a-b": string; a_u2db: string; a_u2db_: string; "a-b_": string }): string {
  return r["a-b"] + "|" + r.a_u2db + "|" + r.a_u2db_ + "|" + r["a-b_"];
}

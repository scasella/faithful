// @redteam area=strings status=held
// @inputs [[{"a-b":"1","a_b":"2","a b":"3","\u00e9":"4","e":"5","_":"6","":"7","v":"8"}]]
export function f(r: { "a-b": string; a_b: string; "a b": string; "é": string; e: string; "_": string; "": string; v: string }): string {
  return r["a-b"] + "|" + r.a_b + "|" + r["a b"] + "|" + r["é"] + "|" + r.e + "|" + r._ + "|" + r[""] + "|" + r.v;
}

// @redteam area=strings status=held
// @inputs [[{"a\"b":"p","c\\d":-1,"\u00e9":true,"x\ny":"q","\u2028":""}],[{"a\"b":"","c\\d":9007199254740991,"\u00e9":false,"x\ny":"\u2028","\u2028":"\""}]]
export function f(r: { "a\"b": string; "c\\d": number; "é": boolean; "x\ny": string; " ": string }): { "a\"b": string; "c\\d": number; "é": boolean; "x\ny": string; " ": string } {
  return { "a\"b": r["x\ny"] + r[" "], "c\\d": r["c\\d"] + 1, "é": !r["é"], "x\ny": r["a\"b"], " ": "" + r["c\\d"] };
}

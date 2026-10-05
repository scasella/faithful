// @redteam area=strings status=held
// @inputs [["a","b","c",",","x","y","abc","b"],["","","","","","","",""],["\u00e9","\u00e9\u00e9","xyz","--","b","a","zz","z"]]
// Lean binder hygiene: string parameters named like Lean/emitter identifiers.
export function f(decide: string, pure: string, Json: string, toString: string, Except: string, List: string, Prop: string, Type: string): string | null {
  if (decide === "") return null;
  return `${decide}|${decide.length}/${pure}|${pure.length}/${Json}|${Json.length}/${toString}|${toString.length}/${Except}|${Except.length}/${List}|${List.length}/${Prop}|${Prop.length}/${Type}|${Type.length}` + pure.slice(1) + Json.split("").join(toString) + (Except < List) + Prop.indexOf(Type);
}

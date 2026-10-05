// @redteam area=strings status=held
// @inputs [["a","b","c",",","x","y","abc","b"],["","","","","","","",""],["\u00e9","\u00e9\u00e9","xyz","--","b","a","zz","z"]]
// Lean binder hygiene: string parameters named like Lean/emitter identifiers (one of 73 single-name probes, consolidated).
export function f(Char: string, Int: string, String: string, Nat: string, Bool: string, Option: string, some: string, none: string): string | null {
  if (Char === "") return null;
  return `${Char}|${Char.length}/${Int}|${Int.length}/${String}|${String.length}/${Nat}|${Nat.length}/${Bool}|${Bool.length}/${Option}|${Option.length}/${some}|${some.length}/${none}|${none.length}` + Int.slice(1) + String.split("").join(Nat) + (Bool < Option) + some.indexOf(none);
}

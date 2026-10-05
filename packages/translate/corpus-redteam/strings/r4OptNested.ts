// @redteam area=strings status=held
// @inputs [["ab",true,true],["ab",true,false],["ab",false,true],["ab",false,false],["",false,false],["\u00e9",true,true]]
export function f(s: string, c: boolean, d: boolean): string | null { return c ? (d ? s.toUpperCase() : null) : d ? null : s + s.charCodeAt(0); }

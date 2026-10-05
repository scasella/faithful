// @redteam area=strings status=held
// @inputs [["ab",true],["ab",false],["\u00e9",true],["\u00e9",false],["",true]]
export function f(s: string, c: boolean): string | null { return c ? s.toUpperCase() : null; }

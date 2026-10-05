// @redteam area=strings status=held
// @inputs [["\u00e9"],["a"],["abcdefghijk"],["\u00e9bcdefghijk"]]
interface P { a: string; b: number }
export function f(s: string): P { return { b: s.charCodeAt(9), a: s.toLowerCase() }; }

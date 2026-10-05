// @redteam area=strings status=held
// @inputs [["\u00e9"],["a"],["abcdefghijk"],["\u00e9bcdefghijk"]]
interface P { a: number; b: string }
export function f(s: string): P { return { b: s.toLowerCase(), a: s.charCodeAt(9) }; }

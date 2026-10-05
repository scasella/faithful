// @redteam area=strings status=held
// @inputs [["\u00e9"],["a"]]
export function f(s: string): number { const c = s.charCodeAt(5); return s.length; }

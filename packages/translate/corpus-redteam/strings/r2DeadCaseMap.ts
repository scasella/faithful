// @redteam area=strings status=held
// @inputs [["\u00e9"],["a"]]
export function f(s: string): number { const u = s.toUpperCase(); return s.length; }

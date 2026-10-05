// @redteam area=strings status=held
// @inputs [[["b","a","c","a","","\u00e9"]],[["",""]]]
export function f(xs: string[]): string[] { return xs.slice().sort((a, b) => (a < b ? -2 : a > b ? 5 : 0)); }

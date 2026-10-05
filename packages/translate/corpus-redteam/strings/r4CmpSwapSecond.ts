// @redteam area=strings status=held
// @inputs [[["b","a","c","a","","\u00e9"]],[["x"]]]
export function f(xs: string[]): string[] { return xs.slice().sort((a, b) => (b < a ? 1 : a < b ? -1 : 0)); }

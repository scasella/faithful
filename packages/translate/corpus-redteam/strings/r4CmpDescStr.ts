// @redteam area=strings status=held
// @inputs [[["b","a","b","","\u00e9","Z"]],[[]]]
export function f(xs: string[]): string[] { return xs.slice().sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); }

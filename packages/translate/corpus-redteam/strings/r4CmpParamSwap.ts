// @redteam area=strings status=held
// @inputs [[["b","a","c","a","","\u00e9"]],[[]]]
export function f(xs: string[]): string[] { return xs.slice().sort((b, a) => (a < b ? -1 : a > b ? 1 : 0)); }

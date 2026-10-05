// @redteam area=strings status=held
// @inputs [[["b","a","c","a","","\u00e9"]],[["z","y"]]]
export function f(xs: string[]): string[] { return xs.slice().sort((a, b) => (a <= b ? (a === b ? 0 : -1) : 1)); }

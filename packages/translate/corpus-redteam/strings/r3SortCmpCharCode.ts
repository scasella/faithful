// @redteam area=strings status=held expect=refuse code=unsupported-syntax
// @inputs [[["b","","a",""]],[["ba","ab"]]]
export function f(xs: string[]): string[] { return xs.slice().sort((a, b) => a.charCodeAt(0) - b.charCodeAt(0)); }

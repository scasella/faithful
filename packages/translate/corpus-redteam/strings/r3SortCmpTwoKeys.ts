// @redteam area=strings status=held expect=refuse code=unsupported-syntax
// @inputs [[["bb","a","ab","b","","ba"]],[["x","x","y"]]]
export function f(xs: string[]): string[] { return xs.slice().sort((a, b) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0)); }

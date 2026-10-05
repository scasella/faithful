// @redteam area=strings status=held
// @inputs [[["a","b"]],[[]],[["\u00e9"]],[["","x"]]]
export function f(xs: string[]): string { return xs.reduce((acc, x, i) => `${acc}${i}:${x.toUpperCase()};`, ""); }

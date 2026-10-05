// @redteam area=strings status=held
// @inputs [[["a","b","","B","é"],"b"],[[],"x"]]
export function f(xs: string[], t: string): string[] { return xs.filter((x) => x < t || x >= t + "z"); }

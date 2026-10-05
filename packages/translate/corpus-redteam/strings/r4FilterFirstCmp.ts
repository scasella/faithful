// @redteam area=strings status=held
// @inputs [[[]],[["m","a","z","m",""]],[["","\u0000"]]]
export function f(xs: string[]): string[] { return xs.filter((x) => x > xs[0]); }

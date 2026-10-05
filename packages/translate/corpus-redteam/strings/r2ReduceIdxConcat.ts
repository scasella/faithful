// @redteam area=strings status=held
// @inputs [[[]],[["","#"]],[["a","$","\u00e9"]]]
export function f(xs: string[]): string { return xs.reduce((acc, c, i) => acc + i + c + (c < acc), "#"); }

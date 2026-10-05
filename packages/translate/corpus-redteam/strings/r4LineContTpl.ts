// @redteam area=strings status=held
// @inputs [[""],["z"],["\u2028"]]
export function f(s: string): string { return `a\
b${s}c\d${s}e\ f\ g`; }

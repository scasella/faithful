// @redteam area=strings status=held
// @inputs [[""],["z"],["\r\n"]]
export function f(s: string): string { return s + "a\
b" + "c\d" + "e\ f" + "g\ h"; }

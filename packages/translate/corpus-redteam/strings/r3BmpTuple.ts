// @redteam area=strings status=held
// @inputs [[["😀",1]],[["ab",2]]]
export function f(t: [string, number]): string { return t[0].charAt(t[1]); }

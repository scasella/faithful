// @redteam area=strings status=held
// @inputs [["é",""],["a",""],["é","x"]]
export function f(s: string, t: string): string { return `${t.charCodeAt(0)}${s.toLowerCase()}`; }

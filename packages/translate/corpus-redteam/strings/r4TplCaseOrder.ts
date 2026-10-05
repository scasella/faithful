// @redteam area=strings status=held
// @inputs [["ab","CD"],["","X"],["\u00e9","X"],["a","\u00e9"],["",""]]
export function f(s: string, t: string): string { return `${s.toUpperCase()}-${t.toLowerCase()}-${s.charCodeAt(0)}`; }

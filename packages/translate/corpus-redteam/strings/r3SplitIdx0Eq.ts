// @redteam area=strings status=held
// @inputs [["",""],["a,b","a"],[",",""]]
export function f(s: string, t: string): boolean { return s.split(",")[0] === t && s.split(t).length > 0; }

// @redteam area=strings status=held
// @inputs [[0,""],[1,"\u00e9"],[-1,"llo"],[5,"x"],[2,"h\u00e9llo!"]]
export function f(n: number, s: string): [string, string, number, string, number] { return ["héllo".charAt(n), "héllo".slice(n), "héllo".indexOf(s), "héllo"[2], "é￿".charCodeAt(n)]; }

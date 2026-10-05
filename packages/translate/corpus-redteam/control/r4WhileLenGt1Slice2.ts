// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[""],["a"],["ab"],["abcde"]]
// @redteam-note round 4: string loop `t.length > 1` with t = t.slice(2)
export function f(s: string): string { let t = s; let out = ""; while (t.length > 1) { out = out + t.charAt(1); t = t.slice(2); } return out + "|" + t; }

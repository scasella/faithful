// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note round 4: `t = t.slice(k)` with a variable k: refused (only literal k >= 1 is recognized; documented)
export function f(s: string): string { let t = s; let out = ""; while (t.length > 0) { const c = t.charAt(0); let k = 0; while (k < t.length && t.charAt(k) === c) { k++; } out = out + c + k; t = t.slice(k); } return out; }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[7],[-4]]
// @redteam-note round 4: guard and argument both through const chains (expand + unlet together): accepted, proved
export function f(n: number): number { const a = n; const c = a >= 1; if (c) { const d = a - 1; const e = d; return 1 + f(e); } return 0; }

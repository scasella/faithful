// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3]]
// @redteam-note round 4: locals named like the twin (`f_chkD`, `f_chk`) in a recursive function
export function f(n: number): number { const f_chkD = 1; const f_chk = 2; if (n <= 0) return f_chkD + f_chk; return 1 + f(n - 1); }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3]]
// @redteam-note round 4: locals named `f_pre`, `f_rangeOk`, `f_asciiOk`
export function f(n: number): number { const f_pre = 3; const f_rangeOk = 4; const f_asciiOk = 5; if (n <= 0) return f_pre + f_rangeOk + f_asciiOk; return f(n - 1); }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3]]
// @redteam-note round 4: local named like the loop function (`f_loop1`) in a recursive function with a loop
export function f(n: number): number { const f_loop1 = 7; let s = 0; for (let i = 0; i < n; i++) s += f_loop1; if (n <= 0) return s; return s + f(n - 1); }

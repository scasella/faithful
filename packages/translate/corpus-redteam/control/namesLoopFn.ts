// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[3,4],[0,1]]
export function f(f_loop1: number, f_loop2: number): number { let s = 0; for (let i = 0; i < f_loop1; i++) { s = s + f_loop2; } return s; }

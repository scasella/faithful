// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[3,5],[0,1],[2,-1]]
export function f(end: number, end_: number): number { let s = 0; for (let i = 0; i < end; i++) { s = s + end_; } return s; }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[3,5],[5,3],[-1,4],[0,0]]
export function f(n: number, m: number): number { let i = 0; while (i < n && i < m) { i++; } return i; }

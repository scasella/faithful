// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0,0],[0,5],[-3,4],[5,0]]
export function f(a: number, b: number): number { let s = 0; for (let i = a; i <= b; i += 2) { s = s * 3 + i; } return s; }

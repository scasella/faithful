// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[-3]]
export function f(n: number): number { let s = 0; let i = 0; while (n > i) { s += i; i++; } return s; }

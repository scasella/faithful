// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[-1]]
export function f(n: number): number { let s = 0; let i = 0; while (i < n) { { let i = 5; i += 1; s += i; } i++; } return s; }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[3,6],[3,7],[0,5],[-2,5],[4,12]]
// @redteam-note round 2: the second conjunct's % runs only when the first holds; at i = n the divisor would be 0
export function f(n: number, m: number): number { let i = 0; let c = 0; while (i < n && m % (n - i) === 0) { c++; i++; } return c; }

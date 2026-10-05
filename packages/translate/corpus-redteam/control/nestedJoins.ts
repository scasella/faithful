// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0,0],[5,2],[30,7]]
export function f(n: number, m: number): number { let a = 0; let b = 1; for (let i = 0; i < n; i++) { if (i % 2 === 0) { if (m > i) { a = a + i; } else { b = b * 2; } } else { a = a - 1; } if (b > 1000) { b = 1; } } return a * 10000 + b; }

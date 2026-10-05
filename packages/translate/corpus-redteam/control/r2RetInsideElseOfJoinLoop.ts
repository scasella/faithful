// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[20],[-1]]
export function f(n: number): number { let s = 0; for (let i = 0; i < n; i++) { if (i % 2 === 0) { s += i; } else { if (s > 10) return s; s -= 1; } } return -s; }

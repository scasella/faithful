// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[7]]
export function f(n: number): number { let c = 0; for (let i = 0; i < n; i++) { if (i % 2 === 0) continue; c = c + i; } return c; }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0,0],[3,3],[4,4],[7,2]]
export function f(m: number, n: number): number { let c = 0; for (let i = 0; i < m; i++) { for (let j = 0; j < n; j++) { c = c + 1; if (i * j === 6) return c * 100 + i * 10 + j; } c = c + 1000; } return c; }

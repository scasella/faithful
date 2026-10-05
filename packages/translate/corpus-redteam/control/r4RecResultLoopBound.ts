// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[3],[5]]
// @redteam-note round 4: self-call result used as a later loop bound
export function f(n: number): number { if (n <= 0) return 1; const m = f(n - 1); let s = 0; for (let i = 0; i < m; i++) { s += 1; } return s + n; }

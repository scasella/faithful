// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[3],[5],[-1],[499],[500]]
// @redteam-note round 2: self-call in the condition of a join if
export function f(n: number): number { if (n <= 0) return 0; let s = 1; if (f(n - 1) > 3) { s = 2; } return s + n; }

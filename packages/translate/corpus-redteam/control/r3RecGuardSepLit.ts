// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[25],[-3],[10],[11]]
// @redteam-note round 3: numeric separator literals (1_0) in guard and step
export function f(n: number): number { if (n <= 1_0) return n; return 1 + f(n - 1_0); }

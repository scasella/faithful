// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[5],[12]]
// @redteam-note round 4: two self-calls per activation (fib): depth checks per call
export function f(n: number): number { if (n < 2) return n; return f(n - 1) + f(n - 2); }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[2],[10],[18],[-4]]
// @redteam-note round 2: tree recursion; depth counter restored after each call
export function f(n: number): number { if (n <= 1) return n; return f(n - 1) + f(n - 2); }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[5],[-1]]
export function f(n: number): number[] { let a: number[] = []; let i = n; while (i > 0) { a = a.concat([i]); i = i - 2; } return a; }

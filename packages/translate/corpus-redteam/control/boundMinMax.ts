// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0,0],[5,-3],[-2,2]]
export function f(n: number, m: number): number { let c = 0; for (let i = Math.min(n, m); i < Math.max(n, m, 3); i++) { c = c + 1; } return c; }

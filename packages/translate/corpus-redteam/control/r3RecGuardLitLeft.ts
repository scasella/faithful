// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[-3],[-2],[0],[9],[-100]]
// @redteam-note round 3: guard with a negative literal on the left: `-3 >= n`
export function f(n: number): number { if (-3 >= n) return 0; return 1 + f(n - 2); }

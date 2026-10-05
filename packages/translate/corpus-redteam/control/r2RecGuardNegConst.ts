// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[-4],[-3],[-2],[0],[5],[990],[995]]
export function f(n: number): number { if (n < -3) return 0; return 1 + f(n - 2); }

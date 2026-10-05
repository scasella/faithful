// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[-10],[-5],[-4],[3]]
export function f(n: number): number { let s = 0; for (let i = n; i >= -5; i--) { s += i; } return s; }

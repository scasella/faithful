// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[13],[-13]]
export function f(n: number): number { let c = 0; for (let i = 0; i < n % 7; i++) { c = c + 1; } return c; }

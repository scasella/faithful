// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[5],[-1]]
// @redteam-note round 3: `n >= i` (flipped) with i += 2
export function f(n: number): number { let s = 0; for (let i = 0; n >= i; i += 2) { s += i; } return s; }

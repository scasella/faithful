// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[-1]]
// @redteam-note round 2: body declares its own `let i` and increments it; the loop counter is untouched (JS: 11 per iteration)
export function f(n: number): number { let s = 0; for (let i = 0; i < n; i++) { let i = 10; i++; s += i; } return s; }

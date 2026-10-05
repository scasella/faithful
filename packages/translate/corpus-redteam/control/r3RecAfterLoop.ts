// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[-2]]
// @redteam-note round 3: self-call after a plain loop (measure walk through letState)
export function f(n: number): number { let s = 0; for (let i = 0; i < 3; i++) { s += i; } if (n <= 0) return s; return s + f(n - 1); }

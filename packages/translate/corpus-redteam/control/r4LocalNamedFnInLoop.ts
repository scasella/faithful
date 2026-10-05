// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3]]
// @redteam-note round 4: loop-body `const f` shadowing the function name, self-call after the loop
export function f(n: number): number { let s = 0; for (let i = 0; i < 2; i++) { const f = i; s += f; } if (n <= 0) return s; return s + f(n - 1); }

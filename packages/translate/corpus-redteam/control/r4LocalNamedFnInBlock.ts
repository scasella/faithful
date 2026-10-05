// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[-1]]
// @redteam-note round 4: block-local `const f` shadowing the function name, self-call after the block
export function f(n: number): number { let s = 0; { const f = 5; s = f; } if (n <= 0) return s; return s + f(n - 1); }

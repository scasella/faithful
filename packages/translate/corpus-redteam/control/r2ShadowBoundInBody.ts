// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[5],[-2]]
// @redteam-note round 2: the body declares `const n` shadowing the bound `n` of the loop condition
export function f(n: number): number { let s = 0; for (let i = 0; i < n; i++) { const n = i * 2; s += n; } return s + n; }

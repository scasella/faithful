// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[1,1073741824],[1,2],[0,0],[2,-3]]
// @redteam-note round 4: object literal: overflow first, throwing self-call second
interface P { a: number; b: number }
export function f(n: number, m: number): P { if (n <= 0) { if (m > 2) throw new Error("boom"); return { a: 0, b: 0 }; } return { b: m * m, a: f(n - 1, m).a }; }

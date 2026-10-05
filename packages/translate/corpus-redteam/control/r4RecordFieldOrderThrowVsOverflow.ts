// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[1,1073741824],[1,2],[0,0],[2,-3]]
// @redteam-note round 4: object literal fields in non-declaration order: self-call (throws) first, overflow second; JS source order decides throw vs range-violation
interface P { a: number; b: number }
export function f(n: number, m: number): P { if (n <= 0) { if (m > 2) throw new Error("boom"); return { a: 0, b: 0 }; } return { b: f(n - 1, m).b, a: m * m }; }

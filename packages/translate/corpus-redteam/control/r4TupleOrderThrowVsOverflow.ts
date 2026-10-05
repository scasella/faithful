// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[1,1073741824],[1,2],[0,0]]
// @redteam-note round 4: tuple literal: throwing self-call first, overflow second
export function f(n: number, m: number): [number, number] { if (n <= 0) { if (m > 2) throw new Error("boom"); return [0, 0]; } return [f(n - 1, m)[0], m * m]; }

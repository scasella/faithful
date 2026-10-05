// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3]]
// @redteam-note round 4: unreachable loop without a measure after continue: never lowered
export function f(n: number): number { let s = n; for (let i = 0; i < 3; i++) { s += i; continue; while (s > 0) { s = s + 1; } } return s; }

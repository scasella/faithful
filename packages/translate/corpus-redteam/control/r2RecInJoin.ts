// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[5],[-4],[498],[499],[500]]
// @redteam-note round 2: self-call inside an if without jumps (a join); the guard must reach decreasing_by
export function f(n: number): number { let r = 0; if (n > 0) { r = f(n - 1) + n; } return r + 1; }

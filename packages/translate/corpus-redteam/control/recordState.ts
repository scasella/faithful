// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[5],[10]]
export function f(n: number): { x: number; y: number } { let p = { x: 0, y: 1 }; for (let i = 0; i < n; i++) { p = { x: p.x + p.y, y: p.x }; } return p; }

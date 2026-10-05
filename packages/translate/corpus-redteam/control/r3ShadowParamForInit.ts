// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[7],[-1]]
// @redteam-note round 3: for-init `let n` shadows the parameter n; the parameter is read after the loop
export function f(n: number): number { let s = 0; for (let n = 0; n < 3; n++) { s += n; } return s * 100 + n; }

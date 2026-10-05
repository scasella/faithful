// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[5],[-2]]
// @redteam-note round 3: a parameter is the loop counter (empty for-init) and is read after the loop
export function f(n: number): number { let s = 0; for (; n > 0; n--) { s += n; } return s * 100 + n; }

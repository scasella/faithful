// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[5],[-4],[7]]
// @redteam-note round 3: counting down by 3 to a parameter-dependent negative bound
export function f(n: number): number { let c = 0; for (let i = n; i > -n; i -= 3) { c = c * 2 + 1; } return c; }

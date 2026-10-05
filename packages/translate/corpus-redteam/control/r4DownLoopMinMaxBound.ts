// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[5,2],[0,0],[-3,4],[10,-10]]
// @redteam-note round 4: counting down from Math.max to Math.min (bound expression is a call on invariant params)
export function f(a: number, b: number): number { let c = 0; for (let i = Math.max(a, b); i >= Math.min(a, b); i -= 3) { c += i; } return c; }

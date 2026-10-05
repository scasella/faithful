// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0,5],[3,1]]
// @redteam-note round 4: parameter named `τd` (the twin's depth binder) in a recursive function
export function f(d: number, τd: number): number { if (d <= 0) return τd; return f(d - 1, τd + 1); }

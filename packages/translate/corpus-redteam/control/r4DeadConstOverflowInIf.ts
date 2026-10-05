// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[94906267],[3],[0]]
// @redteam-note round 4: unused const with an overflowing product inside an if: JS evaluates it, so rangeOk must be false
export function f(n: number): number { if (n > 0) { const t = n * n; } return n; }

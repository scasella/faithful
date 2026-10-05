// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1],0],[[1],5],[[],0]]
// @redteam-note round 4: unused `&&` whose right operand indexes out of range only when the left is true
export function f(xs: number[], i: number): number { const ok = i >= 0 && xs[i] > 0; return xs.length; }

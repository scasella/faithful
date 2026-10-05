// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[""],["abc"]]
// @redteam-note round 3: recursion in the else-block of `s.length < 1`
export function f(s: string): number { if (s.length < 1) { return 0; } else { return 1 + f(s.slice(1)); } }

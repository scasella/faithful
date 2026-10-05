// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[""],["abcde"]]
// @redteam-note round 3: string shrinking loop under `s.length > 0` with slice(2)
export function f(s: string): number { let c = 0; while (s.length > 0) { c++; s = s.slice(2); } return c; }

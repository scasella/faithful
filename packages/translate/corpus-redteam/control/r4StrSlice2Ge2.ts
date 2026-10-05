// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[""],["a"],["ab"],["abcde"]]
// @redteam-note round 4: string recursion with slice(2) under `s.length >= 2` (else of `< 2`)
export function f(s: string): number { if (s.length < 2) return s.length; return 10 + f(s.slice(2)); }

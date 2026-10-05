// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[""],["abc"]]
// @redteam-note round 3: `0 !== s.length` (literal on the left), string recursion
export function f(s: string): number { if (0 !== s.length) return 1 + f(s.slice(1)); return 0; }

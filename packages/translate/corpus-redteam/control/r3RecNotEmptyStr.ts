// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[""],["abc"]]
// @redteam-note round 3: `!(s === "")` guard
export function f(s: string): number { if (!(s === "")) return 1 + f(s.slice(1)); return 0; }

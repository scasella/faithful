// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[]],[[1,2,3]],[[1,-2,3]],[[5]]]
// @redteam-note round 2: self-call after a loop with returns (in the matchFlow continuation)
export function f(xs: number[]): number { for (const x of xs) { if (x < 0) return -1; } return xs.length === 0 ? 0 : xs[0] + f(xs.slice(1)); }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[""],["a"],["abcd"],["abcdefg"]]
// @redteam-note round 3: slice(3) under length >= 1 (slice past the end)
export function f(s: string): number { if (s.length < 1) return 0; return 1 + f(s.slice(3)); }

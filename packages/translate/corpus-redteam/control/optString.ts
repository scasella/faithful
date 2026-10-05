// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [["abxcd"],[""],["abc"]]
export function f(s: string): string | null { let i = 0; while (i < s.length) { if (s.charAt(i) === "x") return s.slice(i); i = i + 1; } return null; }

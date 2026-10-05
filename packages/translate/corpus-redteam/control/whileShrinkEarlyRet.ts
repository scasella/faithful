// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [["abc","c"],["","a"],["abc","z"]]
export function f(s: string, c: string): number { let i = 0; while (s.length > 0) { if (s.charAt(0) === c) return i; s = s.slice(1); i = i + 1; } return -1; }

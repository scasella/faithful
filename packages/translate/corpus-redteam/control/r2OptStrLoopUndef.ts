// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [["",""],["abc","c"],["abc","d"],["abc",""],["aa","a"]]
export function f(s: string, c: string): number | undefined { for (let i = 0; i < s.length; i++) { if (s.charAt(i) === c) return i; } return undefined; }

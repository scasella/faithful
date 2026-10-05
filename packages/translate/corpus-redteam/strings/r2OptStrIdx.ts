// @redteam area=strings status=held
// @inputs [["abc",""],["abc","c"],["",""],["abc","abcd"],["aXbXc","X"]]
export function f(s: string, t: string): string | null { const i = s.indexOf(t); if (i < 0) return null; return s.slice(0, i) + "|" + s.slice(i + t.length); }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[""],["abc"],["zzzzzzzzzzzzz"]]
export function f(s: string): number { let h = 0; for (let i = 0; i <= s.length; i++) { if (i === s.length) return h; h = h * 31 + s.charCodeAt(i); } return -1; }

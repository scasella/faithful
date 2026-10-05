// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [["ab",3],["",30],["abcd",23],["abcd",22]]
// @redteam-note round 4: unused concatenation inside a loop
export function f(s: string, n: number): number { let t = s; for (let i = 0; i < n; i++) { const u = t + t; t = u.slice(0, t.length + 1); } return t.length; }

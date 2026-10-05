// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[12]]
export function f(n: number): string { let s = ""; for (let i = 0; i < n; i++) { s = s + i; if (s.length > 5) { s = s.slice(1); } } return s; }

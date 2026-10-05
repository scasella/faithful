// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[9007199254740992,2],[0,9007199254740992],[2,1],[4503599627370496,3]]
export function f(n: number, k: number): number { let c = 0; for (let i = 0; i < n * k; i++) { c = c + 1; if (c > 3) return c; } return c; }

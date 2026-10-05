// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[4503599627370496],[1001],[5]]
export function f(n: number): number { const a = n * n; if (n > 1000) throw new Error("big"); return a; }

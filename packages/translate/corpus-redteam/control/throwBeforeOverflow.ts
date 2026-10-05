// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[4503599627370496],[1000],[999],[-9007199254740992]]
export function f(n: number): number { if (n > 1000) throw new Error("big"); return n * n * n * n * n * n; }

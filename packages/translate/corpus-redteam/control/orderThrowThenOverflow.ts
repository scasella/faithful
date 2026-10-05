// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[1,4503599627370496],[3,4503599627370496],[5,9007199254740992],[2,5]]
export function f(n: number, k: number): number { if (n <= 0) throw new Error("bottom"); return f(n - 1, k) + n * k; }

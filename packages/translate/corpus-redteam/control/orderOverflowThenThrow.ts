// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[1,4503599627370496],[2,4503599627370496],[3,4503599627370496],[2,5]]
export function f(n: number, k: number): number { if (n <= 0) throw new Error("bottom"); return n * k + f(n - 1, k); }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[-1],[5]]
export function f(n: number): number { if (n < 0) throw new Error("neg"); if (n === 0) return 0; return 2 + f(n - 1); }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[4],[5],[-1]]
export function f(n: number): number { if (n < 0) throw new Error("neg"); return n === 0 ? 0 : 1 + f(n - 2); }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[-1],[1]]
export function f(n: number): number { if (n < 0) throw new Error("a\u0000b\u001f\u2028"); return n; }

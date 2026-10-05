// @redteam area=strings status=held
// @inputs [[-1],[1]]
export function f(n: number): number { if (n < 0) throw new Error("q"!); return n; }

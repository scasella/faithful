// @redteam area=strings status=held
// @inputs [[-1],[1]]
export function f(n: number): number { if (n < 0) throw new Error("\x001 \u0085\x7f"); return n; }

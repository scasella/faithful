// @redteam area=strings status=held expect=refuse code=unsupported-syntax
// @inputs [[-1],[1]]
const MSG = "neg";
export function f(n: number): number { if (n < 0) throw new Error(MSG); return n; }

// @redteam area=strings status=held
// @inputs [[-1],[0]]
export function f(n: number): number { if (n < 0) throw new Error("a\u0085b\u2028c\u007fd\u0000e\v\f\b\"\\\u00e9\uffff"); return n; }

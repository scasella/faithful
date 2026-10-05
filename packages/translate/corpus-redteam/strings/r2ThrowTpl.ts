// @redteam area=strings status=held
// @inputs [[-1],[3]]
export function f(n: number): number { if (n < 0) throw `neg\u00e9\uffff\t`; return n; }

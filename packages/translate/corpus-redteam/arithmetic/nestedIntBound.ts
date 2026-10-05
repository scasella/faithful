// @redteam area=arithmetic status=held expect=ok
// @inputs [[[[1.5]],{"k":1,"t":[1,"a"]}],[[[9007199254740994]],{"k":1,"t":[1,"a"]}],[[],{"k":0.5,"t":[1,"a"]}],[[],{"k":1,"t":[18014398509481984,"a"]}],[[[1]],{"k":2,"t":[3,"a"]}]]
// int-bound precondition must cover numbers nested in arrays, records and tuples (1.5 and 2^53+2 rejected)
export function nestedIntBound(xs: number[][], r: { k: number; t: [number, string] }): number { return xs.length + r.k + r.t[0]; }

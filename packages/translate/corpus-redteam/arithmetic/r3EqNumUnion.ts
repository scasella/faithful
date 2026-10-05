// @redteam area=arithmetic status=held expect=ok round=3
// number vs literal union `3 | 5` with == and ===; the int-bound precondition does not restrict b to {3, 5} (sound: the body is type-erased)
// @inputs [[3,3],[5,3],[3,5]]
// @tags ["ok","ok","ok"]
export function r3EqNumUnion(a: number, b: 3 | 5): boolean { return a == b && a === b; }

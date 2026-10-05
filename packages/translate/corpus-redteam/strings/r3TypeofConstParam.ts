// @redteam area=strings status=held
// @inputs [["ab"],["zz"]]
const K = "ab";
export function f(s: typeof K): string { return s.toUpperCase() + K; }

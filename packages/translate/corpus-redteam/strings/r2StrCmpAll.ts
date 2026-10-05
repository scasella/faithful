// @redteam area=strings status=held
// @inputs [["ab","a"],["",""],["\u00e9","z"],["\uffff","\u00ff"],["a",""],["Z","a"],["abc","abd"],["\ud7ff","\ue000"]]
export function f(a: string, b: string): boolean[] { return [a < b, a <= b, a > b, a >= b, a === b, a !== b, a == b, a != b]; }

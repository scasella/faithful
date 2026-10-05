// @redteam area=strings status=held
// @inputs [["\u0000"],["\uffff\ud7ff"],[""],["a\u0000b"]]
export function f(s: string): number[] { return s.split("").map((c) => c.charCodeAt(0) - 1); }

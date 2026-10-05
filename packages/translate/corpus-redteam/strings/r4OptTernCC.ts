// @redteam area=strings status=held
// @inputs [[""],["a"],["\u00e9z"],["\uffff"]]
export function f(s: string): number | undefined { return s === "" ? undefined : s.charCodeAt(s.length - 1) + s.charCodeAt(0); }

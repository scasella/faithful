// @redteam area=strings status=held
// @inputs [[""],["a"],["\uffff"]]
export function f(s: string): number { return s.charAt(s.length).length + s.charCodeAt(s.length - 1); }

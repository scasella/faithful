// @redteam area=strings status=held
// @inputs [[""],["abc"],["\uffff\uffff"]]
export function f(s: string): number { let n = 0; while (s.length > 0) { n = n + s.charCodeAt(0); s = s.slice(1); } return n; }

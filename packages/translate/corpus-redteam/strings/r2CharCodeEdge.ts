// @redteam area=strings status=held
// @inputs [["\u0000\uffff\ud7ff\ue000"],[""],["\u00ff\u0100"]]
export function f(s: string): number { let t = 0; for (const c of s.split("")) { t = t + c.charCodeAt(0) * 3; } return t; }

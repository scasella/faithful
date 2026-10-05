// @redteam area=strings status=held
// @inputs [["\u00e9"],["e\u0301"],["\u0000"],["A"],[""]]
export function f(s: string): boolean[] { return [s === "\u00e9", s === "e\u0301", s.length === 1, "\x41" === "A", s === "\0"]; }

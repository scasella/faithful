// @redteam area=strings status=held
// @inputs [["b"],["\ud800"]]
export function f(s: "\uD800" | "b"): number { return s.length; }

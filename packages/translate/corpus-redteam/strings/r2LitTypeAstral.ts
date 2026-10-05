// @redteam area=strings status=held
// @inputs [["b"]]
export function f(s: "\u{1F600}" | "b"): number { return s.length; }

// @redteam area=strings status=held
// @inputs [[""],["a"],["é￿\u0000"],["a-b"]]
export function f(s: string): string { return s.split("").map((c) => c.charCodeAt(0)).join("-"); }

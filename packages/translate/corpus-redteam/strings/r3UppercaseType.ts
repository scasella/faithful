// @redteam area=strings status=held expect=refuse code=unsupported-type
// @inputs [["AB"]]
export function f(s: Uppercase<string>): string { return s + "x"; }

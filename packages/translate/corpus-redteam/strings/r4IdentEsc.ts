// @redteam area=strings status=held
// @inputs [[""],["q"]]
export function f(s: string): string { return s + "\q\v\b\f\'\u{0000041}\u{e9}\x7f\%" + `\q\v\b\f\u{000000e9}\'\"`; }

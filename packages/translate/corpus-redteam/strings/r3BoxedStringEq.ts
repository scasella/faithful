// @redteam area=strings status=held expect=refuse code=dictionary
// @inputs [["ab","ab"]]
export function f(s: String, t: String): boolean { return s === t; }

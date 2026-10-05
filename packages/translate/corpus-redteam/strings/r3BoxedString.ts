// @redteam area=strings status=held expect=refuse code=dictionary
// Round 3 note: the boxed `String` type is refused, but under code `dictionary` (its numeric index signature), not `unsupported-type`; the refusal is sound, the reason imprecise.
// @inputs [["ab"],[""]]
export function f(s: String): number { return s.length; }

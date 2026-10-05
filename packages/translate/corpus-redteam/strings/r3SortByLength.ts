// @redteam area=strings status=held expect=refuse code=unsupported-syntax
// Round 3 completeness finding (not a divergence): `a.length - b.length` on string[] is a valid int-key comparator but is refused ("key field on a non-record").
// @inputs [[["bb","a","cc","d",""]],[["xyz","ab","cd","e"]]]
export function f(xs: string[]): string[] { return xs.slice().sort((a, b) => a.length - b.length); }

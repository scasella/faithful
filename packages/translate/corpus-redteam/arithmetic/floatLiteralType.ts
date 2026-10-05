// @redteam area=arithmetic status=divergence input=[2.5] ts=ok:5 lean=excluded-by-int-bound expect=refuse code=float severity=completeness:low
// accepted, but the parameter type admits the non-integer 2.5, which the int-bound precondition then silently excludes (half the declared domain is outside the model); a non-integer number literal type should be refused as float
export function floatLiteralType(a: 1 | 2.5): number { return a * 2; }

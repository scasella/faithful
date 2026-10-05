// @redteam area=control status=divergence input=[2,9007199254740989] ts={"tag":"ok","value":9007199254740992} lean={"tag":"ok","value":9007199254740993}
// @redteam-expect ok
// @redteam-inputs [[2,9007199254740989],[1,5]]
// @redteam-note Loop-carried accumulation with a parameter of literal-union type `1 | 2`: `a + s` is not instrumented
// @redteam-note (isNum(a) is false for a union), so the instrumented original returns ok 9007199254740992 (2^53 - 3 + 2 + 2
// @redteam-note rounded) while Lean rangeOk = false (exact 9007199254740993). Same wrong rule as unionConstMul.ts.
export function f(a: 1 | 2, n: number): number { let s = n; for (let i = 0; i < 2; i++) { s = a + s; } return s; }

// @redteam area=control status=divergence input=[3002399751580331,false] ts={"tag":"ok","value":9007199254740992} lean={"tag":"ok","value":9007199254740993}
// @redteam-expect ok
// @redteam-inputs [[3002399751580331,false],[5,true]]
// @redteam-note `const k = b ? 2 : 3` has checker type `2 | 3` (a union, TypeFlags.Union, not NumberLike), so
// @redteam-note instrument.ts `isNum` is false for `k` and `n * k` is NOT routed through __faithful.mul. The Lean twin does
// @redteam-note check it: Model.f_rangeOk = false (exact product 9007199254740993 > 2^53). The instrumented original
// @redteam-note returns ok 9007199254740992 (the rounded double), i.e. the TS side claims the input is inside the model.
// @redteam-note tsVsLean reports a `range-ok` disagreement. Wrong rule: instrument.ts isNum/isStr must use the same
// @redteam-note type mapping as lower.ts (unions of number literals are `int`, NOTES.md "Types").
// @redteam-note Severity: the Lean `pre` is right, so no theorem is affected; the TS-side range filter is unsound.
export function f(n: number, b: boolean): number { const k = b ? 2 : 3; return n * k; }

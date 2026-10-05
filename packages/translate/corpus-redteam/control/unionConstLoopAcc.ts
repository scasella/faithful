// @redteam area=control status=divergence input=[6,true] ts={"tag":"fault","detail":"result 1000000000000000000 is outside +-2^53 at $"} lean={"tag":"range-violation","detail":"Model.f_rangeOk = false, Model.f_pre = false (model value 1000000000000000000)"}
// @redteam-expect ok
// @redteam-inputs [[6,true],[5,true],[3,false]]
// @redteam-note Loop with `s = s * k`, `k: 1000 | 3`: the multiplication escapes instrumentation, the loop overflows
// @redteam-note silently and only the sandbox's result backstop notices, classifying it as a `fault` instead of
// @redteam-note `range-violation` (the correct outcome, which Lean's rangeOk = false agrees with). Intermediate overflows
// @redteam-note that do not reach the result (e.g. followed by `% 7`) would not be caught at all. Same wrong rule as
// @redteam-note unionConstMul.ts.
export function f(n: number, b: boolean): number { const k = b ? 1000 : 3; let s = 1; for (let i = 0; i < n; i++) { s = s * k; } return s; }

// @redteam area=control status=divergence input=[3] ts={"tag":"ok","value":6} lean={"tag":"fault","detail":"model does not compile: failed to prove termination; goal ↑(n.toNat - 1) < n with done : Bool := decide (n ≤ 0), h : ¬done = true"}
// @redteam-expect ok
// @redteam-inputs [[0],[-1],[3],[499],[500]]
// @redteam-note round 2, completeness. findRecursionMeasure's `expand` inlines the let-bound boolean `done` and finds n >= 1 under the guard,
// @redteam-note so the function is accepted with measure (n - 1 + 1).toNat; the measure is valid. But the emitted decreasing_by (faithful_decreasing:
// @redteam-note simp_wf/omega) only sees `h : ¬done = true` with `done : Bool := decide (n ≤ 0)` as a let and fails, in Model.f and in Model.f_chkD.
// @redteam-note translate() returns ok with a Lean model that does not compile. Expected (this test): the model compiles with tier proved (fix the hint,
// @redteam-note e.g. zeta-reduce/simp the let-bound guard into the hypothesis). If the fixer prefers refusal, change @redteam-expect to refuse:no-termination-measure.
// @redteam-note Int-typed lets go through (r2RecLetArg, r2RecGuardAlias, r2RecLenLocal held); Bool-typed lets do not.
export function f(n: number): number { const done = n <= 0; if (done) return 0; return n + f(n - 1); }

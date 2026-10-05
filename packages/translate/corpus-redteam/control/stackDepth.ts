// @redteam area=control status=divergence input=[100000] ts={"tag":"fault","detail":"stack overflow"} lean={"tag":"ok","value":100000}
// @redteam-expect ok
// @redteam-inputs [[10],[1000],[100000],[1000000]]
// @redteam-fault-inputs [[100000],[1000000]]
// @redteam-note Linear self-recursion: the measure finder accepts it (n decreases, n >= 1 under the guard) and Lean's
// @redteam-note model returns 100000 with Model.f_pre = true, but V8 throws RangeError (Maximum call stack size exceeded)
// @redteam-note at depth ~1e4-1e5. No precondition (int-bound, range-ok) excludes recursion depth, so a theorem
// @redteam-note `pre n -> f n = n` is "proved" while the TypeScript crashes on n = 100000. tsVsLean counts it as a
// @redteam-note ts fault (never agreement) but not as a disagreement, so the corpus suite cannot see it.
export function f(n: number): number { if (n <= 0) return 0; return 1 + f(n - 1); }

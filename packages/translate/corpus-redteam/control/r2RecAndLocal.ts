// @redteam area=control status=divergence input=[3] ts={"tag":"ok","value":3} lean={"tag":"fault","detail":"model does not compile: failed to prove termination; ok_ : Bool := decide (n > 0) && decide (n < 1000), h : ¬¬ok_ = true"}
// @redteam-expect ok
// @redteam-inputs [[0],[1],[5],[999],[1000],[-3]]
// @redteam-note round 2, completeness; same root cause as r2RecGuardBoolLocal (let-bound Bool guard, here a conjunction, not visible to decreasing_by).
export function f(n: number): number { const ok = n > 0 && n < 1000; if (!ok) return 0; return f(n - 1) + 1; }

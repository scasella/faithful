// @redteam area=control status=divergence input=["ab"] ts={"tag":"ok","value":2} lean={"tag":"fault","detail":"model does not compile: failed to prove termination (let-bound e : Bool := decide (s = []))"}
// @redteam-expect ok
// @redteam-inputs [[""],["a"],["hello"]]
// @redteam-note round 2, completeness; same root cause as r2RecGuardBoolLocal (string form: const e = s === "").
export function f(s: string): number { const e = s === ""; if (e) return 0; return 1 + f(s.slice(1)); }

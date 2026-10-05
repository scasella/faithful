// @redteam area=control status=divergence input=[2] ts={"tag":"fault","detail":"uncaught ReferenceError: LIMIT is not defined"} lean={"tag":"ok","value":8}
// @redteam-expect ok
// @redteam-inputs [[2],[-3]]
// @redteam-note Loop bound read from a module-level `const LIMIT = 4` (accepted and inlined, NOTES.md "Closures"). The
// @redteam-note instrumented original carries the const (instrumentedTs prepends it) and returns 8, the Lean model returns
// @redteam-note 8, but tsVsLean loads the PLAIN original from `t.source.text`, which is the function statement only, so the
// @redteam-note plain run throws ReferenceError and every input is an `instrumentation` disagreement. No function that
// @redteam-note reads a module constant can ever be compared. Wrong rule: engine/src/differential/differential.ts line ~215
// @redteam-note (`sb.load(idP, t.source.text, ...)`) must load the module constants too (or Translation.source must carry
// @redteam-note them). Harness completeness, not a model bug.
const LIMIT = 4;
export function f(n: number): number { let c = 0; for (let i = 0; i < LIMIT; i += 1) { c = c + n; } return c; }

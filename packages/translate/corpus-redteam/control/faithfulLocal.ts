// @redteam area=control status=divergence input=[1] ts={"tag":"fault","detail":"uncaught ReferenceError: Cannot access '__faithful' before initialization"} lean={"tag":"ok","value":6}
// @redteam-expect ok
// @redteam-inputs [[1],[0]]
// @redteam-note Block scoping: a local `const __faithful` puts the runtime name in its TDZ inside its own initializer
// @redteam-note (`__faithful.mul(n, 2)`), so the instrumented original faults on every input (plain original and Lean: 6
// @redteam-note for n = 1). Same wrong rule as faithfulParam.ts (instrument.ts: non-hygienic runtime identifier).
export function f(n: number): number { const __faithful = n * 2; let s = 0; for (let i = 0; i < 3; i++) { s = s + __faithful; } return s; }

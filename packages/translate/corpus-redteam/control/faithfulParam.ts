// @redteam area=control status=divergence input=[1] ts={"tag":"fault","detail":"uncaught TypeError: __faithful.add is not a function"} lean={"tag":"ok","value":2}
// @redteam-expect ok
// @redteam-inputs [[1],[0]]
// @redteam-note Shadowing: a parameter named `__faithful` shadows the instrumentation runtime object that instrumentedTs
// @redteam-note calls (`__faithful.add(...)`). The plain original returns 2, the Lean model returns 2, the instrumented
// @redteam-note original faults on EVERY input, so tsVsLean compares nothing (0 of N) yet the translation is accepted.
// @redteam-note Wrong rule: instrument.ts uses a fixed free identifier without checking user bindings; either refuse
// @redteam-note `__faithful` as an identifier (unsupported-syntax) or rename the runtime binding hygienically.
export function f(__faithful: number): number { return __faithful + 1; }

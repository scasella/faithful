// @redteam area=strings status=divergence expect=ok input=["a"] ts=fault:"RangeError: Invalid string length" lean=pre-true,model:1073741824
// @inputs [[""],["ab"]]
// V8 limits strings to 2^29 - 24 UTF-16 units (Node v25.8.1); `+` throws RangeError beyond it. strConcat is not a
// CHECKED_OPS operation, so the _chk twin (and range-ok / pre) never bounds string length: pre is true on ["a"] while
// the original faults. Same class as round 1 stackDepth. Correct behaviour: the instrumented original reports
// range-violation (not fault) and the Lean twin agrees.
export function f(s: string): number { let t = s; for (let i = 0; i < 30; i++) { t = t + t; } return t.length; }

// @redteam area=strings status=divergence expect=ok input=["a,b"] ts=ok:["a","b"] lean=ok:["a","b"];plain-original=fault:"SEP is not defined"
// Harness bug (packages/engine/src/differential/differential.ts, tsVsLean step 1): the plain original is loaded from
// `t.source.text`, which is only the function statement, so a module-level `const` the translator inlines is undefined
// there. Every input becomes an `instrumentation` disagreement (false alarm; no unsoundness).
const SEP = ",";
export function moduleConstHarness(s: string): string[] {
  return s.split(SEP);
}

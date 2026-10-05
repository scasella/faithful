// @redteam area=strings status=divergence expect=ok input=[""] ts=ok:["x\ty\u0000,é\"\\\n'￿","\u0000,é\"\\\n'￿",""] lean=agrees;plain-original=fault:"PRE-is-not-defined"
// Same root cause as moduleConstHarness: the Lean model and the instrumented original agree (module constants with
// escapes are inlined correctly on both sides); the differential harness's plain-original run faults.
// @inputs [[""],["a\u0000b"],["é"]]
const SEP = "\u0000,é\"\\\n'￿";
const PRE = `x\ty`;
export function moduleConstSpecial(s: string): string[] {
  return [PRE + s + SEP, `${SEP}${s}`, s.split(SEP).join("|")];
}

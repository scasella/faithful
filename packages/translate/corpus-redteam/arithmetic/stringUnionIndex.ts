// @redteam area=arithmetic status=divergence input=[true,5] ts=ok:"undefined!" lean=ok:"A!",rangeOk=false expect=range-violation root-cause=instrument.ts-isNum/isStr/isIndexable severity=soundness:ts-side-range-ok-enforcement
// same root cause, bounds check: instrument.ts isIndexable is false for the union type `"ab" | "x"`, so s[i] is not routed through __faithful.at (overlaps the strings area)
export function stringUnionIndex(c: boolean, i: number): string { return (c ? "ab" : "x")[i] + "!"; }

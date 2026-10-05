// @redteam area=arithmetic status=divergence input=[true] ts=ok:"é" lean=ok:"É",asciiOk=false expect=range-violation root-cause=instrument.ts-isNum/isStr/isIndexable severity=soundness:ts-side-range-ok-enforcement
// same root cause, ascii check: instrument.ts isStr is false for the union type `"É" | "A"`, so toLowerCase is not routed through __faithful.lower (overlaps the strings area)
export function stringUnionLower(c: boolean): string { return (c ? "\u00c9" : "A").toLowerCase(); }

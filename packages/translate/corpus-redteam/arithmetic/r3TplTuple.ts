// @redteam area=arithmetic status=held expect=refuse code=unsupported-syntax round=3
// "" + tuple is the array ToString
export function r3TplTuple(t: [number, number]): string { return "" + t; }

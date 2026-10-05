// @redteam area=arithmetic status=held expect=refuse code=unsupported-library round=3
// n.toString() without radix: not in the v1 list (template literals are)
export function r3ToStr(a: number): string { return a.toString(); }

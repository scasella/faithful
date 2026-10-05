// @redteam area=arithmetic status=held expect=refuse code=unsupported-library round=3
// String(n) (ToString) is not in the v1 library list
export function r3StringCall(a: number): string { return String(a); }

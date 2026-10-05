// @redteam area=arithmetic status=held expect=refuse code=unsupported-library round=3
// Number(s) can produce NaN and non-integers
export function r3NumberCall(s: string): number { return Number(s); }

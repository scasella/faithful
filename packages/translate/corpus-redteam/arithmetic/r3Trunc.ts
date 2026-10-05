// @redteam area=arithmetic status=held expect=refuse code=unsupported-library round=3
// Math.trunc of an integer (truncOfDiv covered Math.trunc(a / b))
export function r3Trunc(a: number): number { return Math.trunc(a); }

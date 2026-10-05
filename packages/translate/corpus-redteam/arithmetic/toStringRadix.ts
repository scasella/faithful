// @redteam area=arithmetic status=held expect=refuse code=unsupported-library
export function toStringRadix(a: number): string { return a.toString(2); }

// @redteam area=arithmetic status=held expect=refuse code=float round=3
// a division inside a conditional inside Math.floor
export function r3TernDiv(a: number, b: number, c: boolean): number { return Math.floor(c ? a / b : a); }

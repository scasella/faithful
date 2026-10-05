// @redteam area=arithmetic status=held expect=refuse code=unsupported-library round=3
// Math.imul is 32-bit wrapping multiplication; modeling it as * would be wrong
export function r3Imul(a: number, b: number): number { return Math.imul(a, b); }

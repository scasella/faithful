// @redteam area=arithmetic status=held expect=refuse code=unsupported-library round=3
// Math.clz32 is a 32-bit operation
export function r3Clz(a: number): number { return Math.clz32(a); }

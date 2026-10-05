// @redteam area=arithmetic status=held expect=refuse code=unsupported-library round=3
// Math.sign(-0) is -0; not in the v1 list
export function r3Sign(a: number): number { return Math.sign(a); }

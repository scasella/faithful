// @redteam area=arithmetic status=held expect=refuse code=bitwise
export function shiftAssign(a: number): number { let x = a; x <<= 1; return x; }

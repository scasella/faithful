// @redteam area=arithmetic status=held expect=refuse code=bitwise
export function orAssign(a: number): number { let x = a; x |= 1; return x; }

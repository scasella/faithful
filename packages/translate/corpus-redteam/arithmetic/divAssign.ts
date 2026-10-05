// @redteam area=arithmetic status=held expect=refuse code=float
export function divAssign(a: number): number { let x = a; x /= 2; return x; }

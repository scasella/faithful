// @redteam area=arithmetic status=held expect=refuse code=unsupported-syntax round=3
// assignment as an expression (value and evaluation order of (x = e) + x)
export function r3AssignExpr(a: number): number { let x = 0; return (x = a * 2) + x; }

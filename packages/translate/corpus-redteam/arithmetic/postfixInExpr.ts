// @redteam area=arithmetic status=held expect=refuse code=unsupported-syntax
export function postfixInExpr(a: number): number { let x = a; const y = x++; return y; }

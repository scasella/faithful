// @redteam area=arithmetic status=held expect=refuse code=unsupported-syntax round=3
// ++x as an expression
export function r3PrefixExpr(a: number): number { let x = a; return ++x; }

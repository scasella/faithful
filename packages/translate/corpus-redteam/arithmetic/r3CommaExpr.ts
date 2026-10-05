// @redteam area=arithmetic status=held expect=refuse code=unsupported-syntax round=3
// comma operator (refused through its TypeScript diagnostic)
export function r3CommaExpr(a: number): number { return (a, a * 2); }

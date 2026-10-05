// @redteam area=arithmetic status=held expect=refuse code=unsupported-syntax round=3
// the binary ** operator (powAssign covered **=)
export function r3PowLit(a: number): number { return a * 2 ** 3; }

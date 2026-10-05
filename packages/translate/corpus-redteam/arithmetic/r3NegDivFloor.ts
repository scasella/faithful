// @redteam area=arithmetic status=held expect=refuse code=float round=3
// Math.floor(-(a / b)) is not -fdiv(a, b) (floor(-3.5) = -4); the division is not the direct argument
export function r3NegDivFloor(a: number, b: number): number { return Math.floor(-(a / b)); }

// @redteam area=arithmetic status=held expect=refuse code=float round=3
// Math.floor(<number>(a / b)): the division is not the direct argument of Math.floor
export function r3CastWhole(a: number, b: number): number { return Math.floor(<number>(a / b)); }

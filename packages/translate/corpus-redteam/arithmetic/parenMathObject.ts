// @redteam area=arithmetic status=held expect=refuse code=float
export function parenMathObject(a: number, b: number): boolean { return (Math).floor(a / b) > 0; }

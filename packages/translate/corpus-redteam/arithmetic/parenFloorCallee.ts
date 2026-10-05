// @redteam area=arithmetic status=held expect=refuse code=float
export function parenFloorCallee(a: number, b: number): boolean { return (Math.floor)(a / b) > 0; }

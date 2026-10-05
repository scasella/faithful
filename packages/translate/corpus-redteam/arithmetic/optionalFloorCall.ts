// @redteam area=arithmetic status=held expect=refuse code=unsupported-syntax
export function optionalFloorCall(a: number, b: number): boolean { return Math.floor?.(a / b) > 0; }

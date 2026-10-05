// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function refuseLooseEqMixed(s: string, n: number): boolean { return s == n; }

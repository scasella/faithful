// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function refuseUnaryPlusStr(s: string): number { return +s; }

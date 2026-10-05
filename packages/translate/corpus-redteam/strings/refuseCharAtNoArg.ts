// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function refuseCharAtNoArg(s: string): string { return s.charAt(); }

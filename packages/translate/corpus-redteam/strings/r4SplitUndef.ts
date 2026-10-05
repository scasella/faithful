// @redteam area=strings status=held expect=refuse code=unsupported-library
export function f(s: string): string[] { return s.split(",", undefined); }

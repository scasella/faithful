// @redteam area=strings status=held expect=refuse code=unsupported-library
export function refuseReplace(s: string): string { return s.replace("a", "b"); }

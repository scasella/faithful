// @redteam area=strings status=held expect=refuse code=unsupported-library
export function refuseIncludesStr(s: string): boolean { return s.includes("a"); }

// @redteam area=strings status=held expect=refuse code=unsupported-library
export function refuseLocaleUpper(s: string): string { return s.toLocaleUpperCase(); }

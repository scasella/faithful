// @redteam area=strings status=held expect=refuse code=unsupported-library
export function refuseLocaleCompare(a: string, b: string): number { return a.localeCompare(b); }

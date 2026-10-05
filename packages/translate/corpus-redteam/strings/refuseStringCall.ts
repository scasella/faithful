// @redteam area=strings status=held expect=refuse code=unsupported-library
export function refuseStringCall(n: number): string { return String(n); }

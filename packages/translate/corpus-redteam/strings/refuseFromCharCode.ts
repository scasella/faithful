// @redteam area=strings status=held expect=refuse code=unsupported-library
export function refuseFromCharCode(n: number): string { return String.fromCharCode(n); }

// @redteam area=strings status=held expect=refuse code=unsupported-library
export function refuseConcatMethod(a: string, b: string): string { return a.concat(b); }

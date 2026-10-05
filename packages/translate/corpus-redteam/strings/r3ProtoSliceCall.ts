// @redteam area=strings status=held expect=refuse code=unsupported-library
export function f(s: string): string { return String.prototype.slice.call(s, 1); }

// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function f(s: string): string { return String.raw`a\n${s}`; }

// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function f(s: string): number { return new String(s).length; }

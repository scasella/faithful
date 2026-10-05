// @redteam area=strings status=held expect=refuse code=unsupported-library
declare global { interface String { readonly first: string; } }
export function f(s: string): string { return s.first; }

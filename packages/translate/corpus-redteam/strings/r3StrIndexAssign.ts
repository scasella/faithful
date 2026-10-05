// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function f(s: string): string { const t = s; t[0] = "x"; return t; }

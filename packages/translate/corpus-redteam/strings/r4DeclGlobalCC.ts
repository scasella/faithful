// @redteam area=strings status=held expect=refuse code=unsupported-type
declare global { interface String { charCodeAt(index: number): string; } }
export function f(s: string): string { const c = s.charCodeAt(0); return c + "x"; }

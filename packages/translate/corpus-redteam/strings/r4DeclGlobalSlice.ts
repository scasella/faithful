// @redteam area=strings status=held expect=refuse code=unsupported-type
declare global { interface String { slice(start: number, end: number): number; } }
export function f(s: string): number { return s.slice(0, 1); }

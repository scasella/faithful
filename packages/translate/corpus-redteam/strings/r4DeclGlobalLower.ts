// @redteam area=strings status=held expect=refuse code=unsupported-type
declare global { interface String { toLowerCase(): number; } }
export function f(s: string): number { const k = s.toLowerCase(); return k; }

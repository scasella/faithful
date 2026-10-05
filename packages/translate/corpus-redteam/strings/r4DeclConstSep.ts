// @redteam area=strings status=held expect=refuse code=mutable-capture
declare const SEP: string;
export function f(s: string): string[] { return s.split(SEP); }

// @redteam area=strings status=held expect=refuse code=unsupported-library
export function refuseCodePointAt(s: string): number | undefined { return s.codePointAt(0); }

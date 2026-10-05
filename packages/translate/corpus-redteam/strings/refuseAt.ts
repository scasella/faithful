// @redteam area=strings status=held expect=refuse code=unsupported-library
export function refuseAt(s: string): string | undefined { return s.at(-1); }

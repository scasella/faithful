// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function refuseTruthyString(s: string): boolean { return s ? true : false; }

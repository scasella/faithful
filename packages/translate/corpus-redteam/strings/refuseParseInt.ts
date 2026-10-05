// @redteam area=strings status=held expect=refuse code=unsupported-library
export function refuseParseInt(s: string): number { return parseInt(s); }

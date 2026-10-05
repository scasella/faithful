// @redteam area=strings status=held expect=refuse code=regex
export function refuseSplitRegex(s: string): string[] { return s.split(/,/); }

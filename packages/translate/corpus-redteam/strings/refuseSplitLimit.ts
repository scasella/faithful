// @redteam area=strings status=held expect=refuse code=unsupported-library
export function refuseSplitLimit(s: string): string[] { return s.split(",", 2); }

// @redteam area=arithmetic status=held expect=refuse code=unsupported-library round=3
// parseInt can produce NaN
export function r3ParseInt(s: string): number { return parseInt(s, 10); }

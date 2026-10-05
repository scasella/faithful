// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function refuseForOfString(s: string): number { let n = 0; for (const c of s) { n = n + c.length; } return n; }

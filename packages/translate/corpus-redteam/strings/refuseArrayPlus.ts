// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function refuseArrayPlus(s: string, xs: number[]): string { return s + xs; }

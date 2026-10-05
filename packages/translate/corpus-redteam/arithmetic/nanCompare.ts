// @redteam area=arithmetic status=held expect=refuse code=nan
export function nanCompare(a: number): boolean { return a !== NaN; }

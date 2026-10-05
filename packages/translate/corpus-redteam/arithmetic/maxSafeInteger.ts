// @redteam area=arithmetic status=held expect=refuse code=unsupported-library
export function maxSafeInteger(a: number): number { return Number.MAX_SAFE_INTEGER - a; }

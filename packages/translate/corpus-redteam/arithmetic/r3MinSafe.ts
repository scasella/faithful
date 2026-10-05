// @redteam area=arithmetic status=held expect=refuse code=unsupported-library round=3
// Number.MIN_SAFE_INTEGER is -(2^53 - 1); not in the list
export function r3MinSafe(a: number): number { return Number.MIN_SAFE_INTEGER + a; }

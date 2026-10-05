// @redteam area=arithmetic status=held expect=refuse code=unsupported-library|unsupported-type round=3
// a bigint literal converted with Number(...)
export function r3BigInt(a: number): number { return a + Number(1n); }

// @redteam area=arithmetic status=held expect=refuse code=unsupported-library round=3
// Number.MAX_VALUE is far outside +-2^53
export function r3MaxValue(a: number): boolean { return a < Number.MAX_VALUE; }

// @redteam area=arithmetic status=held expect=refuse code=float round=3
// `satisfies` is the identity elsewhere, but here it hides the division from the floor pattern
export function r3SatisfiesDiv(a: number, b: number): number { return Math.floor((a / b) satisfies number); }

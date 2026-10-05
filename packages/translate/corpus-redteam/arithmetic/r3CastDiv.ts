// @redteam area=arithmetic status=held expect=refuse code=unsupported-syntax round=3
// angle-bracket type assertion (the refusal text says `as`; same node family)
export function r3CastDiv(a: number, b: number): number { return Math.floor(<number>a / b); }

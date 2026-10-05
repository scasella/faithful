// @redteam area=arithmetic status=held expect=refuse code=unsupported-syntax
export function unaryPlusBool(b: boolean): number { return +b; }

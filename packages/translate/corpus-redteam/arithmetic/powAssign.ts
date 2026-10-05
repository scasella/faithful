// @redteam area=arithmetic status=held expect=refuse code=unsupported-syntax
export function powAssign(a: number): number { let x = a; x **= 2; return x; }

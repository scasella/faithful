// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function refuseNumberSortDefault(xs: number[]): number[] { return xs.slice().sort(); }

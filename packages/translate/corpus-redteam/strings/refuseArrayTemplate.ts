// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function refuseArrayTemplate(xs: number[]): string { return `${xs}`; }

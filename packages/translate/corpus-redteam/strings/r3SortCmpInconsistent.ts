// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function f(xs: string[]): string[] { return xs.slice().sort((a, b) => (a < b ? -1 : 1)); }

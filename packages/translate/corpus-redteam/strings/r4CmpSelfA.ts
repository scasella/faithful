// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function f(xs: string[]): string[] { return xs.slice().sort((a, b) => (a < a ? -1 : a > a ? 1 : 0)); }

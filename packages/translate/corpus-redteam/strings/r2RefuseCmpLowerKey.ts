// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function f(xs: string[]): string[] { return xs.slice().sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0); }

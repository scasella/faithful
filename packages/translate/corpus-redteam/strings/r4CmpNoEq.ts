// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function f(xs: { k: string }[]): string[] { return xs.slice().sort((a, b) => a.k < b.k ? -1 : 1).map((x) => x.k); }

// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function f(xs: { k: string; v: number }[]): number[] { return xs.slice().sort((a, b) => (a.k < a.k ? -1 : b.k > a.k ? -1 : b.k < a.k ? 1 : 0)).map((x) => x.v); }

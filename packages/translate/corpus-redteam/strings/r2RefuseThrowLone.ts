// @redteam area=strings status=held expect=refuse code=non-bmp
export function f(n: number): number { if (n < 0) throw new Error("bad\uD800"); return n; }

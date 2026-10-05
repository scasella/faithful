// @redteam area=strings status=held expect=refuse code=non-bmp
export function f(n: number): number { if (n < 0) throw new Error("bad\u{1F600}"); return n; }

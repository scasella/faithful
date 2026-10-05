// @redteam area=strings status=held expect=refuse code=non-bmp
const E = "\u{1F600}";
export function f(s: string): string { return s + E; }

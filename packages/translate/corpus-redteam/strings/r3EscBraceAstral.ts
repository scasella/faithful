// @redteam area=strings status=held expect=refuse code=non-bmp
export function f(s: string): number { return (s + "\u{1F600}").length; }

// @redteam area=strings status=held expect=refuse code=non-bmp
export function f(n: number): { "\uD800": number } { return { "\uD800": n }; }

// @redteam area=strings status=held expect=refuse code=non-bmp
export function f(s: string): string { return `${s}\uD800${s}`; }

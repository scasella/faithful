// @redteam area=strings status=held expect=refuse code=non-bmp
export function refuseLoneSurrogate(s: string): string { return s + "\uD800"; }

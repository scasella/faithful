// @redteam area=strings status=held expect=refuse code=non-bmp
export function refuseAstralLiteral(s: string): string { return s + "😀"; }

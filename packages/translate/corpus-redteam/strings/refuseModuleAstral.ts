// @redteam area=strings status=divergence expect=refuse code=non-bmp input=["x"] ts=ok:"x😀" lean=translate()-throws
const SMILE = "😀";
export function refuseModuleAstral(s: string): string { return s + SMILE; }

// @redteam area=strings status=divergence expect=refuse code=non-bmp input=["x"] ts=ok:"\ud83dx" lean=translate()-throws
const HALF = "\uD83D";
export function refuseModuleLone(s: string): string { return HALF + s; }

// @redteam area=arithmetic status=held expect=refuse code=unsupported-syntax round=3
// an array in a template literal is Array.prototype.join(","), not intToStr
export function r3TplArray(xs: number[]): string { return `${xs}`; }

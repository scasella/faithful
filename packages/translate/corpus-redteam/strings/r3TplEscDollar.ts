// @redteam area=strings status=held
// @inputs [["ab"],[""],["${"]]
export function f(s: string): string { return `\${s}${s}\\${s}$${s}{}`; }

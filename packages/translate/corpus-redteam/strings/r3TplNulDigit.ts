// @redteam area=strings status=held
// @inputs [[3],[-4],[0]]
export function f(n: number): string { return `\x001${n}\x002\0`; }
